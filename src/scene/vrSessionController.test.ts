import assert from 'node:assert/strict';
import test from 'node:test';
import {checkImmersiveVRSupport} from './vrSessionController';

test('checkImmersiveVRSupport returns true when navigator.xr supports immersive-vr', async () => {
  const supported = await checkImmersiveVRSupport({
    isSessionSupported: async (mode) => mode === 'immersive-vr',
  });
  assert.equal(supported, true);
});

test('checkImmersiveVRSupport returns false when navigator.xr is missing or throws', async () => {
  assert.equal(await checkImmersiveVRSupport(undefined), false);
  assert.equal(
    await checkImmersiveVRSupport({
      isSessionSupported: async () => {
        throw new Error('Not allowed');
      },
    }),
    false
  );
});
