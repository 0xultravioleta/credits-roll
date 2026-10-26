// Only application-authored action errors may reach the dashboard verbatim.
export class DashboardActionError extends Error {
  readonly statusCode = 409;
}
