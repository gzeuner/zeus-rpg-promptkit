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
const path = require('path');
const { executeFetch } = require('../../core/fetchService');
const { resolveFetchConfig } = require('../../config/runtimeConfig');
const { runClCommand } = require('../../fetch/jt400CommandRunner');

/**
 * --clean-remote: löscht das IFS-Arbeitsverzeichnis auf IBM i vor dem Fetch.
 * Verhindert, dass ein abgebrochener Bulk-Fetch nachfolgende Downloads verlangsamt.
 */
async function cleanRemoteIfsDir(args, verbose) {
  let fetchConfig;
  try {
    fetchConfig = resolveFetchConfig(args, { cwd: process.cwd() });
  } catch (err) {
    throw new Error(`Konfigurationsfehler für --clean-remote: ${err.message}`);
  }

  const ifsDir = fetchConfig.ifsDir;
  if (!ifsDir) {
    throw new Error(
      '--clean-remote: ifsDir konnte nicht ermittelt werden (ZEUS_FETCH_IFS_DIR oder --ifs-dir setzen).'
    );
  }

  // CL-Befehl: IFS-Arbeitsverzeichnis samt Inhalt entfernen.
  // Das nachfolgende Fetch legt das Verzeichnis via ensureRemoteDirectory neu an.
  const rmCmd = `RMVDIR DIR('${ifsDir}') SUBTREE(*ALL) RMVLNK(*YES)`;
  if (verbose) {
    console.log(`[verbose] --clean-remote: ${rmCmd}`);
  }
  console.log(`Bereinige IFS-Verzeichnis: ${ifsDir} ...`);

  const result = runClCommand({
    host: fetchConfig.host,
    user: fetchConfig.user,
    password: fetchConfig.password,
    command: rmCmd,
    verbose,
  });

  // CPFA0A9 = Objekt nicht gefunden — kein Fehler, Verzeichnis war leer
  const isNotFound =
    (result.stderr || '').includes('CPFA0A9') ||
    (result.messages || []).some(m => String(m).includes('CPFA0A9'));

  if (!result.ok && !isNotFound) {
    const msgs = (result.messages || []).join('; ') || result.stderr || 'Unbekannter Fehler';
    throw new Error(`--clean-remote fehlgeschlagen: ${msgs}`);
  }

  console.log('IFS-Verzeichnis bereinigt.');
}

async function runFetch(args) {
  const verbose = Boolean(args.verbose);

  if (args['clean-remote']) {
    try {
      await cleanRemoteIfsDir(args, verbose);
    } catch (err) {
      console.error(err.message);
      process.exit(2);
    }
  }

  try {
    const { config, summary } = await executeFetch(args);

    // Env-Overrides immer sichtbar machen (nicht nur im verbose-Modus),
    // damit eine stille Übersteuerung von Profilwerten nicht überrascht.
    if (config.hostEnvOverride) {
      console.warn(
        `[WARN] ZEUS_FETCH_HOST="${config.hostEnvOverride.envValue}" überschreibt` +
          ` Profil-Wert "${config.hostEnvOverride.profileValue}".` +
          ' Benutze --host <HOST> zum expliziten Setzen.'
      );
    }
    if (config.sourceLibEnvOverride) {
      console.warn(
        `[WARN] ZEUS_FETCH_SOURCE_LIB="${config.sourceLibEnvOverride.envValue}" überschreibt` +
          ` Profil-Wert "${config.sourceLibEnvOverride.profileValue}".` +
          ' Benutze --source-lib <LIB> zum expliziten Setzen.'
      );
    }

    if (verbose) {
      console.log(`[verbose] Fetch host: ${config.host}`);
      console.log(`[verbose] Fetch port: ${config.port}`);
      console.log(`[verbose] Object library: ${config.sourceLib}`);
      console.log(`[verbose] Source files: ${config.files.join(', ')}`);
      console.log(`[verbose] IFS dir: ${config.ifsDir}`);
      console.log(`[verbose] Local out: ${path.resolve(process.cwd(), config.out)}`);
      console.log(`[verbose] Stream file encoding: ${summary.encodingPolicy}`);
      console.log(`[verbose] Download transport: ${config.transport}`);
      if (config.networkType) {
        console.log(`[verbose] Network type hint: ${config.networkType}`);
      }
      if (config.preferTransport) {
        console.log(`[verbose] Preferred transport: ${config.preferTransport}`);
      }
      if (config.members.length > 0) {
        console.log(`[verbose] Members (global filter): ${config.members.join(', ')}`);
      }
    }

    console.log(`Exported streamfiles: ${summary.exportedSuccess}/${summary.exportedTotal}`);
    console.log(`Downloaded files: ${summary.downloadedCount}`);
    console.log(`Download transport used: ${summary.transportUsed}`);
    console.log(`Source encoding policy: ${summary.encodingPolicy}`);
    console.log(`Local destination: ${summary.localDestination}`);
    // Ablage-Struktur explizit machen, damit klar ist, wo die Sourcen liegen und
    // was anschliessend als --source / sourceRoot fuer `analyze` zu verwenden ist.
    console.log('Ablage-Struktur: <Local destination>/<SOURCE-FILE>/<MEMBER>.<ext>');
    console.log(`  Beispiel: ${summary.localDestination}/QRPGLESRC/MYPGM.rpgle`);
    console.log(
      `  -> Fuer die Analyse:  zeus analyze --source ${summary.localDestination} --member <NAME>`
    );
    if (summary.importManifestPath) {
      console.log(`Import manifest: ${summary.importManifestPath}`);
    }
    if (summary.transportDiagnostics && summary.transportDiagnostics.strategyRecommendation) {
      console.log(
        `Recommended transport order: ${summary.transportDiagnostics.strategyRecommendation.join(' -> ')}`
      );
    }
    if (summary.notes.length > 0) {
      console.log('Notes:');
      for (const note of summary.notes) {
        console.log(`- ${note}`);
      }
    }
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

module.exports = {
  runFetch,
};
