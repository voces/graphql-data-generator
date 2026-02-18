// deno-lint-ignore-file jsx-no-useless-fragment no-unused-vars
/// <reference types="https://esm.sh/@types/jest@29.5.3/index.d.ts" />
// @deno-types="npm:@types/react"
import React, { useMemo } from "npm:react";
import {
  ApolloLink,
  type Operation,
  useApolloClient,
} from "npm:@apollo/client@3";
import { onError } from "npm:@apollo/client@3/link/error";
import {
  MockedProvider as ApolloMockedProvider,
  MockedProviderProps,
  MockedResponse,
  MockLink,
} from "npm:@apollo/client@3/testing";
import { waitFor } from "npm:@testing-library/dom";
import { DocumentNode, Kind, print } from "npm:graphql";
import { diff as jestDiff } from "npm:jest-diff";
import "npm:@testing-library/react/dont-cleanup-after-each";
import { cleanup } from "npm:@testing-library/react";
import { addTypenameToDocument } from "npm:@apollo/client@3/utilities";

export type ExtendedMockedResponse = MockedResponse & {
  stack?: string;
  watch?: boolean;
  optional?: boolean;
};

type CustomReporterResult = {
  failedExpectations: unknown[];
};

type JasmineEnv = {
  addReporter: (
    props: { specStarted: (result: CustomReporterResult) => void },
  ) => void;
};

let currentSpecResult: CustomReporterResult | undefined;
(globalThis.jasmine as unknown as { getEnv: () => JasmineEnv } | undefined)
  ?.getEnv()
  .addReporter({
    specStarted: (result) => currentSpecResult = result,
  });

const alreadyFailed = () => {
  if (currentSpecResult) return currentSpecResult.failedExpectations.length > 0;

  const state = expect.getState();
  return state.assertionCalls > state.numPassingAsserts ||
    state.suppressedErrors.length > 0;
};

let _skipCleanupAfterEach = false;
/**
 * `@testing-library/react` automatically unmounts React trees that were mounted
 * with render after each test, which `graphql-data-generator` hijacks to ensure
 * cleanup is done after all mocks are consumed. Invoke this functions to
 * disable automatic cleanup.
 * @param value
 */
export const skipCleanupAfterEach = (value = false) => {
  _skipCleanupAfterEach = value;
};

const afterTest: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  const hooks = afterTest.splice(0);
  for (const hook of hooks) await hook();
  if (!_skipCleanupAfterEach) cleanup();
});

const diff = (a: unknown, b: unknown) =>
  jestDiff(a, b, { omitAnnotationLines: true })
    ?.replace(/\w+ \{/g, "{") // Remove class names
    .replace(/\w+ \[/g, "["); // Remove array class names

const getOperationDefinition = (document: DocumentNode) =>
  document.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);

const getOperationType = (operation: Operation) =>
  getOperationDefinition(operation.query)?.operation ??
    "<unknown operation type>";

const getOperationName = (document: DocumentNode) =>
  getOperationDefinition(document)?.name?.value;

const getOperationInfo = (document: DocumentNode) => {
  const def = getOperationDefinition(document);
  return {
    name: def?.name?.value ?? "<unknown operation>",
    operationType: def?.operation ?? "<unknown operation type>",
  };
};

const getErrorMessage = (operation: Operation, mockLink: MockLink) => {
  const operationType = getOperationType(operation);
  const key = JSON.stringify({
    query: print(addTypenameToDocument(operation.query)),
  });
  // Bypassing private variable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alts = ((mockLink as unknown as {
    mockedResponsesByKey: Record<string, MockedResponse[]>;
  })
    .mockedResponsesByKey[key] ?? []) as MockedResponse[];
  let errorMessage =
    `Expected ${operationType} ${operation.operationName} to have been mocked`;

  if (alts.length || Object.keys(operation.variables).length > 0) {
    errorMessage += ` with variables ${
      Deno.inspect(operation.variables, { depth: Infinity, colors: true })
    }`;
  }

  if (alts.length > 1) {
    errorMessage +=
      `, found ${alts.length} similar operations with differing variables:${
        alts
          .slice(0, 9)
          .map((o, i) =>
            `\n${i + 1}.\n${diff(operation.variables, o.request.variables)}`
          )
          .join("")
      }`;
    if (alts.length > 9) errorMessage += `\n... and ${alts.length - 9} more`;
  } else if (alts.length === 1) {
    errorMessage += `, found similar operation with differing variables:\n${
      diff(operation.variables, alts[0].request.variables)
    }`;
  }

  return {
    message: errorMessage,
    stack: alts[0] && "stack" in alts[0] && typeof alts[0].stack === "string"
      ? alts[0]?.stack
      : undefined,
  };
};

let _failRefetchWarnings = false;
/**
 * In older versions of `@apollo/client`, refetches with missing mocks trigger
 * warnings instead of being treated as standard missing mocks.
 * This utility converts those warnings into failures and ensures watch queries
 * are installed for queries with `watch: true`. This must be set when
 * `MockedProvider` is mounted.
 *
 * This is not required on modern version of `@apollo/client`.
 */
export const failRefetchWarnings = (value = true) =>
  _failRefetchWarnings = value;

let _allowMissingMocks = false;
/**
 * Allows missing mocks, resulting in tests passing. Usage is intended to ease
 * migration.
 */
export const allowMissingMocks = (value: true) => _allowMissingMocks = value;

const AutoWatch = ({ mocks }: { mocks: ExtendedMockedResponse[] }) => {
  const client = useApolloClient();
  for (const mock of mocks) if (mock.watch) client.watchQuery(mock.request);
  return null;
};

let lastMocks: ExtendedMockedResponse[] = [];

// deno-lint-ignore ban-types
const getStack = (to: Function) => {
  const obj: { stack?: string } = {};
  Error.captureStackTrace(obj, to);
  return obj.stack;
};

const _waitForMocks = async (
  mocks: ExtendedMockedResponse[],
  { cause, timeout }: {
    cause?: string;
    timeout?: number;
    ignoreFailed?: boolean;
  },
) => {
  for (const mock of mocks) {
    if (mock.optional || mock.error) continue;
    try {
      await waitFor(() => {
        if (alreadyFailed()) return;
        if ((mock.result as jest.Mock).mock.calls.length === 0) {
          throw new Error("");
        }
      }, { timeout });
    } catch {
      const { name, operationType } = getOperationInfo(mock.request.query);
      const err = new Error(
        `Expected to have used ${operationType} ${name}${
          mock.request.variables
            ? ` with variables ${
              Deno.inspect(mock.request.variables, {
                depth: Infinity,
                colors: true,
              })
            }`
            : ""
        }`,
      );
      if (mock.stack) {
        err.stack = `${mock.stack}${cause ? `\nCaused by: ${cause}` : ""}`;
      } else if (cause) err.stack = cause;
      err.stack = `${err.message}\n${
        err.stack?.split("\n").slice(1).join("\n")
      }`;
      expect.getState().suppressedErrors.push(err);
    }
  }
};

/**
 * Wait for mocks to have been used.
 * @param mock If `undefined`, waits for all mocks. If a number, waits fort he first `mocks` mocks. If a string, waits for all mocks up until and including that mock.
 * @param options Additional configuration options.
 */
export const waitForMocks = async (
  mock: number | string = lastMocks.length,
  { timeout, offset = 0 }: {
    /** Milliseconds to wait for each mock. */
    timeout?: number;
    /** If `mocks` is a string, grabs the `offset`th mock of that name (e.g., the third `getReport` mock) */
    offset?: number;
  } = {},
) => {
  if (typeof mock === "string") {
    const matches = lastMocks.map((m, i) => [m, i] as const)
      .filter(([m]) => getOperationName(m.request.query) === mock);
    if (matches.length <= offset) {
      const err = new Error(`Expected mock ${mock} to have been mocked`);
      Error.captureStackTrace(err, waitForMocks);
      err.stack = err.message + "\n" +
        err.stack?.split("\n").slice(1).join("\n");
      throw err;
    }
    expect(matches.length).toBeGreaterThan(offset);
    mock = matches[offset][1] + 1;
  }
  await _waitForMocks(lastMocks.slice(0, mock), {
    timeout,
    cause: getStack(waitForMocks),
  });
};

const isDocument = (thing: unknown): thing is DocumentNode =>
  !!thing && typeof thing === "object" && "kind" in thing &&
  thing.kind === "Document";

const getBareOperationName = (operation: string | unknown) => {
  if (typeof operation === "string") return operation;
  if (isDocument(operation)) return getOperationName(operation) ?? "<unknown>";
  return "<unknown>";
};

/**
 * A wrapper for `@apollo/client/testing`, this component will assert all
 * requests have matching mocks and all defined mocks are used unless marked
 * `optional`.
 */
export const MockedProvider = (
  { mocks, stack: renderStack, children, link: passedLink, ...rest }:
    & Omit<MockedProviderProps, "mocks">
    & {
      mocks: ReadonlyArray<ExtendedMockedResponse>;
      stack?: string;
    },
) => {
  const observableMocks = useMemo(() => {
    const observableMocks = mocks.map((m) =>
      typeof m.result === "function" && "mock" in m.result ? m : {
        ...m,
        stack: m.stack,
        result: Object.assign(
          jest.fn((vars) =>
            typeof m.result === "function" ? m.result(vars) : m.result
          ),
          m.result,
        ),
      }
    );
    lastMocks = observableMocks;
    afterTest.push(() => _waitForMocks(lastMocks, { cause: renderStack }));
    return observableMocks;
  }, [mocks]);

  const link = useMemo(() => {
    const mockLink = new MockLink(observableMocks);
    mockLink.showWarnings = false;

    const errorLoggingLink = onError(({ networkError, operation }) => {
      if (
        _allowMissingMocks ||
        !networkError?.message?.includes("No more mocked responses")
      ) return;
      const { message, stack: altStack } = getErrorMessage(operation, mockLink);
      networkError.message = message;
      if (altStack) {
        networkError.stack = renderStack
          ? `${altStack}\nCaused By: ${renderStack}`
          : altStack;
      } else if (renderStack) networkError.stack = renderStack;
      networkError.stack = message + "\n" +
        networkError.stack?.split("\n").slice(1).join("\n");
      expect.getState().suppressedErrors.push(networkError);
    });

    return ApolloLink.from([
      errorLoggingLink,
      ...(passedLink ? [passedLink] : []),
      mockLink,
    ]);
  }, [observableMocks, renderStack]);

  if (_failRefetchWarnings) {
    const oldWarn = console.warn.bind(console.warn);
    console.warn = (message, operation, ...etc) => {
      if (
        typeof message !== "string" ||
        !message.match(/Unknown query.*refetchQueries/)
      ) return oldWarn(message, operation, ...etc);

      const error = new Error(
        `Expected query ${
          getBareOperationName(operation)
        } requested in refetchQueries options.include array to have been mocked`,
      );
      error.stack = error.message + "\n" +
        renderStack?.split("\n").slice(1).join("\n");
      expect.getState().suppressedErrors.push(error);
    };
    afterTest.push(() => {
      console.warn = oldWarn;
    });
  }

  return (
    <ApolloMockedProvider {...rest} link={link}>
      <>
        <AutoWatch mocks={observableMocks} />
        {children}
      </>
    </ApolloMockedProvider>
  );
};
