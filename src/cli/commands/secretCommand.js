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
const path = require('path');
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
  isWindows,
  storeKeyInWindowsSecureXml,
  resolveKeyFromWindowsSecureXml,
} = require('../../security/secretVault');
const {
  detectPlaintextSecrets,
  SECRET_KEYS,
  isPlaceholder,
} = require('../../security/plaintextSecretDetector');

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
    'Kein Klartext angegeben. Uebergib --value "<geheim>" oder leite den Wert per stdin ein ' +
      '(z. B. `type secret.txt | zeus secret encrypt`).'
  );
}

function printKeyStatus(cwd = process.cwd()) {
  const info = resolveKeyMaterial({ cwd });
  if (info) {
    console.log(`Schlüssel gefunden: ${info.source}`);
    if (info.source.includes('windows')) {
      console.log('  (gespeichert über Windows DPAPI – sicher pro Benutzerkonto)');
    }
  } else {
    console.log('Kein Schlüsselmaterial gefunden.');
    console.log(
      `  -> Setze ${KEY_ENV_VAR} oder erzeuge eine Schlüsseldatei mit: zeus secret init-key`
    );
    if (isWindows()) {
      console.log('     Tipp: "zeus secret init-key --windows" für DPAPI-geschützten Speicher');
    }
  }

  // Secrets-Hygiene: active check for plaintext credentials
  const hygiene = detectPlaintextSecrets({ cwd, checkProfiles: true, env: process.env });
  if (hygiene.length > 0) {
    console.log('');
    console.log('  [WARN] Secrets-Hygiene: Klartext-Credentials erkannt!');
    hygiene.slice(0, 5).forEach(f => {
      console.log(`    - ${f.key}  (in ${f.file}, source: ${f.source})`);
    });
    if (hygiene.length > 5) {
      console.log(`    ... und ${hygiene.length - 5} weitere`);
    }
    console.log('  Empfehlung:');
    console.log('    1. zeus secret init-key   (falls noch kein Schlüssel)');
    console.log('    2. zeus secret encrypt --value "dein-passwort"');
    console.log('    3. Ersetze den Klartext-Wert durch enc:v1:... in deiner .env / profiles.json');
    console.log('  Siehe: docs/quickstart/secrets-and-overrides.md');
  } else {
    console.log('  Keine Klartext-Credentials in .env-Dateien oder Profilen erkannt.');
  }
}

async function runSecret(args) {
  const sub =
    Array.isArray(args._) && args._.length > 0 ? String(args._[0]).trim().toLowerCase() : '';

  if (!sub || sub === 'help') {
    console.log('Usage:');
    console.log(
      '  zeus secret init-key [--force] [--windows]  # Erzeugt Schlüssel (auf Windows optional --windows für DPAPI/Credential-Manager-like Storage)'
    );
    console.log(
      '  zeus secret status                          # Zeigt, ob/woher Schluesselmaterial geladen wird + Hygiene-Check'
    );
    console.log(
      '  zeus secret encrypt [--value <text>]        # Verschluesselt einen Wert -> enc:v1:...  (ohne --value: stdin) + Hygiene-Warnung'
    );
    console.log(
      '  zeus secret decrypt --value <enc:v1:..>     # Entschluesselt einen Wert (nur zum Pruefen)'
    );
    console.log(
      '  zeus secret check [--warn-only]              # Prüft auf Klartext-Credentials (exit 1 bei Problemen; --warn-only => exit 0, für CI warn-only)'
    );
    console.log(
      '  zeus secret migrate [--dry-run] [--no-backup]  # Migriert gefundene Klartext-Secrets zu enc:v1:... (für .env Dateien); --no-backup unterdrückt Klartext-Backup'
    );
    console.log('');
    console.log(
      `Schluessel-Quelle: ${KEY_ENV_VAR} (Vorrang) | Windows DPAPI (--windows) | Datei ${KEY_FILE_RELATIVE}.`
    );
    console.log(
      'Ablage in Profil/.env:  ZEUS_DB_PASSWORD=enc:v1:...   (wird zur Laufzeit transparent entschluesselt)'
    );
    return;
  }

  if (sub === 'init-key') {
    const useWindows =
      isWindows() && (args.windows === true || String(args.windows || '').toLowerCase() === 'true');
    const force = args.force === true || String(args.force || '').toLowerCase() === 'true';

    const keyString = generateKeyString();

    if (useWindows) {
      try {
        const xmlPath = storeKeyInWindowsSecureXml(keyString);
        console.log(
          `Schlüssel in Windows Secure Storage (DPAPI-geschützt) gespeichert: ${xmlPath}`
        );
        console.log('  -> Optional: "zeus secret status" zeigt "windows-secure-xml"');
        console.log(
          '  -> Verschlüssle jetzt Passwörter mit: zeus secret encrypt --value "<passwort>"'
        );
        return;
      } catch (e) {
        console.warn('Windows Secure Storage fehlgeschlagen, falle auf Datei zurück:', e.message);
      }
    }

    const target = getKeyFilePath(process.cwd());
    if (fs.existsSync(target) && !force) {
      console.log(`Schluesseldatei existiert bereits: ${target}`);
      console.log(
        '  -> Mit --force ueberschreiben (ACHTUNG: bestehende verschluesselte Werte werden dann unlesbar).'
      );
      return;
    }
    const written = writeKeyFile(keyString, { cwd: process.cwd() });
    console.log(`Schluesseldatei erstellt: ${written}`);
    console.log(
      '  -> Diese Datei ist geheim, liegt in config/local-only/ (gitignoriert) und darf NICHT geteilt werden.'
    );
    console.log(
      '  -> Verschluessle jetzt Passwoerter mit: zeus secret encrypt --value "<passwort>"'
    );
    return;
  }

  if (sub === 'status') {
    printKeyStatus(process.cwd());

    // Hint for Windows users
    if (isWindows() && resolveKeyFromWindowsSecureXml()) {
      console.log('');
      console.log('  Hinweis: Windows-Schlüssel (DPAPI) ist aktiv. Zum Entfernen:');
      console.log('    Remove-Item "$env:USERPROFILE\\.zeus-secure-key.xml"');
    } else if (isWindows()) {
      const fileKey = getKeyFilePath(process.cwd());
      if (fs.existsSync(fileKey)) {
        console.log('');
        console.log('  Tipp für Windows: Migriere zu sicherem Speicher mit:');
        console.log('    zeus secret init-key --windows --force');
      }
    }
    return;
  }

  if (sub === 'encrypt') {
    if (!hasKeyMaterial()) {
      throw new Error(
        `Kein Schluessel vorhanden. Erzeuge zuerst einen mit "zeus secret init-key" oder setze ${KEY_ENV_VAR}.`
      );
    }

    // Secrets-Hygiene integration: warn before encrypting if plaintext still present
    const hygiene = detectPlaintextSecrets({
      cwd: process.cwd(),
      checkProfiles: true,
      env: process.env,
    });
    if (hygiene.length > 0) {
      console.warn(
        `[WARN] Secrets-Hygiene: ${hygiene.length} Klartext-Credential(s) noch in .env oder Profilen gefunden.`
      );
      console.warn('  Bitte alle migrieren, bevor du weitere Werte verschlüsselst.');
    }

    const plaintext = resolvePlaintext(args);
    const token = encryptSecret(plaintext);
    console.log(token);
    return;
  }

  if (sub === 'decrypt') {
    const token =
      typeof args.value === 'string' && args.value.length > 0
        ? args.value
        : process.stdin.isTTY
          ? ''
          : readStdinSync();
    if (!token) {
      throw new Error('Kein Wert angegeben. Uebergib --value "enc:v1:..." oder per stdin.');
    }
    console.log(decryptSecret(token));
    return;
  }

  if (sub === 'check') {
    const hygiene = detectPlaintextSecrets({
      cwd: process.cwd(),
      checkProfiles: true,
      env: process.env,
    });
    if (hygiene.length > 0) {
      console.log('[FAIL] Secrets-Hygiene: Klartext-Credentials gefunden!');
      hygiene.forEach(f => console.log(`  - ${f.key} in ${f.file} (source: ${f.source})`));
      const warnOnly = args['warn-only'] || args.warnonly === true;
      if (!warnOnly) {
        process.exit(1);
      }
      console.log('  (Exit 0 wegen --warn-only)');
    } else {
      console.log('[PASS] Secrets-Hygiene: Keine Klartext-Credentials gefunden.');
    }
    return;
  }

  if (sub === 'migrate') {
    const dryRun = args['dry-run'] || args.dry === true;
    const noBackup = args['no-backup'] || args.nobackup === true || args.backup === false;
    const hygiene = detectPlaintextSecrets({
      cwd: process.cwd(),
      checkProfiles: true,
      env: process.env,
    });
    if (hygiene.length === 0) {
      console.log('Keine Klartext-Credentials gefunden. Nichts zu migrieren.');
      return;
    }

    if (!hasKeyMaterial()) {
      throw new Error('Kein Schlüssel vorhanden. Bitte zuerst "zeus secret init-key" ausführen.');
    }

    console.log(`Gefundene Klartext-Credentials zum Migrieren (${hygiene.length}):`);
    hygiene.forEach(f => console.log(`  - ${f.key} in ${f.file}`));

    // Focus on .env files for auto-migration (profiles should use env placeholders)
    const envFindings = hygiene.filter(
      f => f.source === 'file' && (f.file.includes('.env') || f.file.includes('env'))
    );
    if (envFindings.length === 0) {
      console.log('Keine .env-Dateien mit Klartext gefunden (Profile-Checks sind Hinweise).');
      return;
    }

    if (dryRun) {
      console.log('\nDry-run: Keine Änderungen vorgenommen.');
      console.log(
        'Führe ohne --dry-run aus, um zu migrieren (Backups werden mit --no-backup unterdrückt).'
      );
      return;
    }

    console.log('\nMigriere...');
    const migratedFiles = new Set();
    // Collect unique .env file paths from findings
    const uniqueEnvFiles = [
      ...new Set(
        envFindings.map(f => {
          return path.isAbsolute(f.file) ? f.file : path.resolve(process.cwd(), f.file);
        })
      ),
    ];

    for (const fullPath of uniqueEnvFiles) {
      if (!fs.existsSync(fullPath)) continue;

      try {
        // Backup (plaintext!) unless --no-backup
        let backup = null;
        if (!noBackup) {
          backup = fullPath + '.bak.' + Date.now();
          fs.copyFileSync(fullPath, backup);
          try {
            fs.chmodSync(backup, 0o600);
          } catch (_) {}
        }

        let content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let changed = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
          if (match) {
            const key = match[1];
            let value = match[2]
              .trim()
              .replace(/\s+#.*$/, '')
              .trim();
            if (
              SECRET_KEYS.test(key) &&
              value &&
              !value.startsWith('enc:v1:') &&
              !isPlaceholder(value)
            ) {
              const encrypted = encryptSecret(value);
              // Preserve original indentation and comment if any
              const prefix = line.match(/^(\s*)/)[1];
              const suffix = line.includes('#') ? ' ' + line.substring(line.indexOf('#')) : '';
              lines[i] = `${prefix}${key}=${encrypted}${suffix}`;
              changed = true;
              migratedFiles.add(fullPath);
            }
          }
        }

        if (changed) {
          fs.writeFileSync(fullPath, lines.join('\n'), 'utf8');
          if (backup) {
            console.log(`  Migriert: ${fullPath}`);
            console.log(`    Backup: ${backup}`);
            console.log(
              '    >>> ACHTUNG: Backup enthält KLARTEXT-Passwörter! Nach Verifikation löschen:'
            );
            console.log(`        rm "${backup}"   (oder del auf Windows)`);
          } else {
            console.log(`  Migriert: ${fullPath} (ohne Backup)`);
          }
        }
      } catch (e) {
        console.error(`  Fehler bei ${fullPath}: ${e.message}`);
      }
    }

    if (migratedFiles.size > 0) {
      console.log(`\nFertig. ${migratedFiles.size} Datei(en) migriert.`);
      console.log(
        '>>> WICHTIG: Prüfen und .bak-Dateien mit Klartext SOFORT löschen (nicht committen).'
      );
      console.log('    Verwendung von --no-backup bei zukünftigen Migrationen vermeidet Backups.');
    } else {
      console.log('Keine automatische Migration durchgeführt (manuelle Überprüfung empfohlen).');
    }
    return;
  }

  throw new Error(
    `Unbekanntes Unterkommando "secret ${sub}". Erlaubt: init-key | status | encrypt | decrypt | check | migrate.`
  );
}

module.exports = {
  runSecret,
};
