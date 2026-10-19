// Fixed test config standing in for the generated tgcloud/lib/config.js. Approval
// mode and the Converter URL are live bindings so a test can switch them on;
// tests/setup.js resets them.

export const ADMIN_ID = 1000;
export let REQUIRE_APPROVAL = false;
export let CONVERTER_URL = '';

/** @param {boolean} on */
export function setRequireApproval(on) {
  REQUIRE_APPROVAL = on;
}

/** @param {string} url */
export function setConverterUrl(url) {
  CONVERTER_URL = url;
}
