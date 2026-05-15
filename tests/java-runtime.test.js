const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  resolveJavaClasspathEntries,
  shouldCompileJavaSources,
} = require('../src/java/javaRuntime');

function createTempJavaProject() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zeus-java-runtime-'));
  fs.mkdirSync(path.join(tempRoot, 'java', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'java', 'lib'), { recursive: true });
  return tempRoot;
}

test('resolveJavaClasspathEntries includes java/bin and jar files from bin and lib', () => {
  const tempRoot = createTempJavaProject();

  try {
    const binJar = path.join(tempRoot, 'java', 'bin', 'jt400.jar');
    const libJar = path.join(tempRoot, 'java', 'lib', 'helper.jar');
    fs.writeFileSync(binJar, '');
    fs.writeFileSync(libJar, '');

    const classpathEntries = resolveJavaClasspathEntries({ cwd: tempRoot });

    assert.deepEqual(classpathEntries, [
      path.join(tempRoot, 'java', 'bin'),
      binJar,
      libJar,
    ]);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('shouldCompileJavaSources detects missing or stale class files', () => {
  const tempRoot = createTempJavaProject();

  try {
    const sourceFile = path.join(tempRoot, 'java', 'Example.java');
    const classFile = path.join(tempRoot, 'java', 'bin', 'Example.class');
    fs.writeFileSync(sourceFile, 'class Example {}', 'utf8');

    assert.equal(
      shouldCompileJavaSources({
        sourceFiles: [sourceFile],
        binDir: path.join(tempRoot, 'java', 'bin'),
      }),
      true,
    );

    fs.writeFileSync(classFile, '', 'utf8');
    const older = new Date(Date.now() - 10_000);
    const newer = new Date(Date.now() - 1_000);
    fs.utimesSync(classFile, older, older);
    fs.utimesSync(sourceFile, newer, newer);

    assert.equal(
      shouldCompileJavaSources({
        sourceFiles: [sourceFile],
        binDir: path.join(tempRoot, 'java', 'bin'),
      }),
      true,
    );

    const newest = new Date();
    fs.utimesSync(classFile, newest, newest);

    assert.equal(
      shouldCompileJavaSources({
        sourceFiles: [sourceFile],
        binDir: path.join(tempRoot, 'java', 'bin'),
      }),
      false,
    );
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
