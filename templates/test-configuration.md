# Test Configuration

## Scheduled Test

- **Turn Off on Failed Test**: <!-- true or false. If true, a scheduled run first reads result.json in the newest run folder under results/ and is skipped when that run failed; a run started by hand always runs. If false, every scheduled run runs. -->
- **Keep Prior Results**: <!-- true or false. If true, Number of Test sets how many run folders results/ keeps. If false, only the newest run folder is kept. -->
  - **Number of Test**: <!-- A whole number, 1 or more: how many YYYY-MM-DDTHH-mm-SS run folders results/ keeps. The oldest is deleted first. Baseline, simulated, and generate-try folders are never counted or deleted. -->

## Send Notifications

- **Send Notifications**: <!-- true or false. If true, the items below say when, and from which account, this test notifies. If false, this test sends no notification, and the items below are ignored. -->
  - **Notify when Test**: <!-- pass, fail, or both. -->
  - **Account Configuration**:
    - **Email**: <!-- The address that sends and receives: an environment variable such as %AUTO_CHECK_EMAIL% or $AUTO_CHECK_EMAIL, or the address itself. Leave null to use the email settings of auto-check config. -->
    - **Password**: <!-- An environment variable that holds the password, such as %AUTO_CHECK_EMAIL_PASSWORD% or $AUTO_CHECK_EMAIL_PASSWORD; set it in this folder's .env, which is git-ignored. Writing the password itself works, but every run warns about it. -->
