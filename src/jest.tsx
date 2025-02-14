import "https://esm.sh/@types/jest@29.5.3/index.d.ts";
// @deno-types="npm:@types/react"
import React, { useMemo } from "npm:react";
import { ApolloLink, type Operation } from "npm:@apollo/client";
import { ErrorLink } from "npm:@apollo/client/link/error/index.js";
import {
  MockedProvider,
  MockedResponse,
  MockLink,
} from "npm:@apollo/client/testing/index.js";

import type { OperationMock } from "./types.ts";
import { waitFor } from "npm:@testing-library/dom";
import { print } from "npm:graphql";
import { diff as jestDiff } from "npm:jest-diff";
// import { dim, green, inverse, red, yellow } from "jsr:@std/fmt@1/colors";

declare namespace jasmine {
  type CustomReporterResult = {
    failedExpectations: unknown[];
  };

  const getEnv: () => {
    addReporter: (
      props: { specStarted: (result: jasmine.CustomReporterResult) => void },
    ) => void;
  };
}

let currentSpecResult: jasmine.CustomReporterResult;
jasmine.getEnv().addReporter({
  specStarted: (result) => currentSpecResult = result,
});

const afterTest: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const hook of afterTest) await hook();
  afterTest.splice(0);
});

const diff = (a: unknown, b: unknown) =>
  jestDiff(a, b, {
    omitAnnotationLines: true,
    // aColor: green,
    // bColor: red,
    // changeColor: inverse,
    // commonColor: dim,
    // patchColor: yellow,
  })
    ?.replace(/\w+ \{/g, "{") // Remove class names
    .replace(/\w+ \[/g, "["); // Remove array class names

const getErrorMessage = (operation: Operation, mockLink: MockLink) => {
  const definition = operation.query.definitions[0];
  const operationType = definition.kind === "OperationDefinition"
    ? definition.operation
    : "<unknown operation type>";
  const key = JSON.stringify({
    query: print(operation.query),
  });
  // Bypassing private variable
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const alts = ((mockLink as unknown as {
    mockedResponsesByKey: Record<string, MockedResponse[]>;
  })
    .mockedResponsesByKey[key] ?? []) as MockedResponse[];
  let errorMessage =
    `Expected GraphQL ${operationType} ${operation.operationName} to have been mocked`;

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

export const MockProvider = (
  { mocks, stack, children }: {
    mocks: OperationMock[];
    stack?: string;
    children?: React.ReactNode;
  },
) => {
  const observableMocks = useMemo(() => {
    const observableMocks = mocks.map((m) => ({
      ...m,
      stack: m.stack,
      result: Object.assign(jest.fn(() => m.result), m.result),
    }));
    afterTest.push(async () => {
      if (currentSpecResult.failedExpectations.length) return;
      for (const mock of observableMocks) {
        if ("optional" in mock && mock.optional || mock.error) continue;
        await waitFor(() => {
          if (currentSpecResult.failedExpectations.length) return;
          if ((mock.result as jest.Mock).mock.calls.length === 0) {
            const err = new Error(
              `Expected to have used mock ${
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
            err.stack = `${err.message}\n${
              mock.stack ?? stack ?? err.stack?.slice(6)
            }`;
            throw err;
          }
        }, { onTimeout: (e) => e });
      }
    });
    return observableMocks;
  }, [mocks]);

  const link = useMemo(() => {
    const mockLink = new MockLink(observableMocks);
    mockLink.showWarnings = false;

    const errorLoggingLink = new ErrorLink(({ networkError, operation }) => {
      if (!networkError?.message.includes("No more mocked responses")) return;
      const { message, stack: altStack } = getErrorMessage(operation, mockLink);
      try {
        networkError.message = message;
        const finalStack = altStack ?? stack
          ? `${message}\n${altStack ?? stack}`
          : undefined;
        if (finalStack) networkError.stack = finalStack;
        fail({ name: "Error", message, stack: finalStack });
      } catch {
        // fail both throws and marks the test as failed in jest; we only need the latter
      }
    });

    // @ts-ignore It's fine
    return ApolloLink.from([errorLoggingLink, mockLink]);
  }, [observableMocks, stack]);

  return <MockedProvider link={link}>{children}</MockedProvider>;
};
