import { OperationMock } from "./types.ts";

export type OperationMockFromType<
  T extends {
    data: Record<string, unknown>;
    variables?: Record<string, unknown>;
  },
> = OperationMock<T["data"], T["variables"]>;
