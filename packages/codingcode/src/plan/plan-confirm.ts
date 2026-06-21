export type PlanConfirmResult =
  | { type: 'allow' }
  | { type: 'modified'; input: Record<string, unknown> }
  | { type: 'canceled' };
