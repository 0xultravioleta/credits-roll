import { expect, test } from 'vitest';
import { APP_NAME } from './index.js';

test('has a name', () => {
  expect(APP_NAME).toBe('Credits Roll');
});
