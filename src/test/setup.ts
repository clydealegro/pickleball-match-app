import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';

// jsdom has no object URLs; photos use them to feed <img>.
if (!URL.createObjectURL) {
  let count = 0;
  URL.createObjectURL = () => `blob:test/${++count}`;
  URL.revokeObjectURL = () => undefined;
}
