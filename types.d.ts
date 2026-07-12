// Global JSDoc type augmentations for core type checking scope.
// Allows common patterns like err.code without mass changes.
interface Error {
  code?: string | number;
  custom?: any;
}

declare const path: any;
declare const fs: any;
declare const process: any;

declare module '*package.json' {
  const value: any;
  export = value;
}
