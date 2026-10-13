import { expect, test } from 'vitest';
import { renderConfig } from '../scripts/gen-config.js';

test('renders the admin ID and approval mode as module exports', () => {
  const source = renderConfig({ ADMIN_ID: '123', REQUIRE_APPROVAL: 'true' });

  expect(source).toContain('export const ADMIN_ID = 123;');
  expect(source).toContain('export const REQUIRE_APPROVAL = true;');
});

test('approval mode defaults to off', () => {
  expect(renderConfig({ ADMIN_ID: '123' })).toContain('export const REQUIRE_APPROVAL = false;');
});

test.each([undefined, '', 'abc', '-5', '1.5'])('refuses ADMIN_ID %j', (adminId) => {
  expect(() => renderConfig({ ADMIN_ID: adminId })).toThrow(/ADMIN_ID/);
});

test('refuses an approval mode other than true/false', () => {
  expect(() => renderConfig({ ADMIN_ID: '1', REQUIRE_APPROVAL: 'yes' })).toThrow(
    /REQUIRE_APPROVAL/,
  );
});
