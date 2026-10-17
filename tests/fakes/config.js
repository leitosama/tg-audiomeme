// Fixed test config standing in for the generated tgcloud/lib/config.js. Approval
// mode is a live binding so a test can switch it on; tests/setup.js resets it.

export const ADMIN_ID = 1000;
export let REQUIRE_APPROVAL = false;

/** @param {boolean} on */
export function setRequireApproval(on) {
  REQUIRE_APPROVAL = on;
}
