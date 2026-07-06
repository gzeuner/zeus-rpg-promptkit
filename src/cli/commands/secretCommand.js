/*
Copyright 2026 gzeuner - tiny-tool.de

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
*/
const fs = require('fs');
const {
  KEY_ENV_VAR,
  KEY_FILE_RELATIVE,
  encryptSecret,
  decryptSecret,
  generateKeyString,
  getKeyFilePath,
  hasKeyMaterial,
  resolveKeyMaterial,
  writeKeyFile,
} = require('../../security/secretVault');

// Liest den gesamten stdin-Inhalt (fuer Passwort-Eingabe ohne Shell-History).
function readStdinSync() {
  try {
    const data = fs.readFileSync(0, 'utf8');
    return data.replace(/\r?\n$/, '');
  } catch (_error) {
    return '';
  }
}

function resolvePlaintext(args) {
  if (typeof args.value === 'string' && args.value.length > 0) {
    return args.value;
  }
  if (!process.stdin.isTTY) {
    const piped = readStdinSync();
    if (piped) {
      return piped;
    }
  }
  throw new Error(
    'Kein Klartext angegeben. Uebergib --value "<geheim>" oder leite den Wert per stdin ein '
    + '(z. B. `type secret.txt | zeus secret encrypt`).',
  );
}

function printKeyStatus() {
  const info = resolveKeyMaterial();
  if (info) {
    console.log(`Schluessel gefunden: ${info.source}`);
  } else {
    console.log('Kein Schluesselmaterial gefunden.');
    console.log(`  -> Setze ${KEY_ENV_VAR} oder erzeuge eine Schluesseldatei mit: zeus secret init-key`);
  }
}

async function runSecret(args) {
  const sub = Array.isArray(args._) && args._.length > 0
    ? String(args._[0]).trim().toLowerCase()
    : '';

  if (!sub || sub === 'help') {
    console.log('Usage:');
    console.log('  zeus secret init-key [--force]           # Erzeugt config/local-only/.zeus-key (32-Byte-Zufallsschluessel)');
    console.log('  zeus secret status                       # Zeigt, ob/woher Schluesselmaterial geladen wird');
    console.log('  zeus secret encrypt [--value <text>]     # Verschluesselt einen Wert -> enc:v1:...  (ohne --value: stdin)');
    console.log('  zeus secret decrypt --value <enc:v1:..>  # Entschluesselt einen Wert (nur zum Pruefen)');
    console.log('');
    console.log(`Schluessel-Quelle: Umgebungsvariable ${KEY_ENV_VAR} (Vorrang) oder Datei ${KEY_FILE_RELATIVE}.`);
    console.log('Ablage in Profil/.env:  ZEUS_DB_PASSWORD=enc:v1:...   (wird zur Laufzeit transparent entschluesselt)');
    return;
  }

  if (sub === 'init-key') {
    const target = getKeyFilePath(process.cwd());
    const force = args.force === true || String(args.force || '').toLowerCase() === 'true';
    if (fs.existsSync(target) && !force) {
      console.log(`Schluesseldatei existiert bereits: ${target}`);
      console.log('  -> Mit --force ueberschreiben (ACHTUNG: bestehende verschluesselte Werte werden dann unlesbar).');
      return;
    }
    const keyString = generateKeyString();
    const written = writeKeyFile(keyString, { cwd: process.cwd() });
    console.log(`Schluesseldatei erstellt: ${written}`);
    console.log('  -> Diese Datei ist geheim, liegt in config/local-only/ (gitignoriert) und darf NICHT geteilt werden.');
    console.log('  -> Verschluessle jetzt Passwoerter mit: zeus secret encrypt --value "<passwort>"');
    return;
  }

  if (sub === 'status') {
    printKeyStatus();
    return;
  }

  if (sub === 'encrypt') {
    if (!hasKeyMaterial()) {
      throw new Error(
        `Kein Schluessel vorhanden. Erzeuge zuerst einen mit "zeus secret init-key" oder setze ${KEY_ENV_VAR}.`,
      );
    }
    const plaintext = resolvePlaintext(args);
    const token = encryptSecret(plaintext);
    console.log(token);
    return;
  }

  if (sub === 'decrypt') {
    const token = typeof args.value === 'string' && args.value.length > 0
      ? args.value
      : (process.stdin.isTTY ? '' : readStdinSync());
    if (!token) {
      throw new Error('Kein Wert angegeben. Uebergib --value "enc:v1:..." oder per stdin.');
    }
    console.log(decryptSecret(token));
    return;
  }

  throw new Error(`Unbekanntes Unterkommando "secret ${sub}". Erlaubt: init-key | status | encrypt | decrypt.`);
}

module.exports = {
  runSecret,
};
