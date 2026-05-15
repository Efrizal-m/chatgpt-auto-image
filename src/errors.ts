export type StopReason =
  | 'limit_detected'
  | 'captcha_detected'
  | 'human_verification_detected'
  | 'login_required'
  | 'network_error'
  | 'submit_disabled_timeout'
  | 'submit_unavailable'
  | 'generation_timeout'
  | 'automation_error';

export class StopAutomationError extends Error {
  constructor(
    public readonly reason: StopReason,
    message: string
  ) {
    super(message);
    this.name = 'StopAutomationError';
  }
}
