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

test('derives the Mini App URL from the tgcloud token, leaving out its secret', () => {
  const source = renderConfig({ ADMIN_ID: '1', TGCLOUD_TOKEN: 'app8757896246:s3cr3t' });

  expect(source).toContain('export const MINI_APP_URL = "https://app8757896246.tgcloud.ai/";');
  expect(source).not.toContain('s3cr3t');
});

test.each([undefined, ''])('leaves the Mini App URL empty without a token (%j)', (token) => {
  expect(renderConfig({ ADMIN_ID: '1', TGCLOUD_TOKEN: token })).toContain(
    'export const MINI_APP_URL = "";',
  );
});

test.each(['s3cr3t', 'app:s3cr3t', 'appX1:s3cr3t', 'app123'])(
  'refuses a malformed tgcloud token %j without echoing it',
  (token) => {
    expect(() => renderConfig({ ADMIN_ID: '1', TGCLOUD_TOKEN: token })).toThrow(
      /^TGCLOUD_TOKEN must look like app<id>:<secret>$/,
    );
  },
);
