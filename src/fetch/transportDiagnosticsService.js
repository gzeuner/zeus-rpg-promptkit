/**
 * Transport Diagnostics Service — Proof of Concept
 * Provides intelligent transport selection and diagnostics for fetch operations
 * 
 * Features:
 * 1. Network type detection (local vs. internet-facing)
 * 2. Transport strategy selection based on environment
 * 3. Detailed diagnostics during fallback attempts
 * 4. Performance timing for each transport
 */

const os = require('os');

/**
 * Transport capabilities matrix
 */
const TRANSPORT_PROFILES = {
  sftp: {
    name: 'SFTP',
    encrypted: true,
    reliable: true,
    speed: 'medium',
    requirements: ['SSH daemon on IBM i', 'Network connectivity'],
    issues: ['May timeout on slow networks', 'Requires SSH keys or passwords'],
    bestFor: 'Internet-facing, security-critical, encrypted data transfer'
  },
  
  jt400: {
    name: 'JT400/JDBC',
    encrypted: false,  // Can be encrypted with SSL
    reliable: true,
    speed: 'fast',
    requirements: ['Native IBM i network', 'JDBC driver (jt400.jar)', 'DB2 running'],
    issues: ['Slow over internet', 'Requires direct network connectivity'],
    bestFor: 'Local network, fastest option, direct IBM i APIs'
  },
  
  ftp: {
    name: 'FTP',
    encrypted: false,
    reliable: false,
    speed: 'slow',
    requirements: ['FTP daemon on IBM i'],
    issues: ['Unencrypted', 'Unreliable firewall traversal', 'Legacy protocol'],
    bestFor: 'Last resort, legacy systems only'
  }
};

/**
 * Detect network environment characteristics
 * 
 * @returns {Object} Network profile
 */
function detectNetworkProfile() {
  const profile = {
    isLocalNetwork: isLocalNetworkConnection(),
    isEncryptionRequired: process.env.ZEUS_REQUIRE_ENCRYPTION !== 'false',
    hasDirectIbmiAccess: canReachIbmiDirectly(),
    bandwidth: estimateBandwidth(),
    latency: estimateLatency()
  };
  
  return profile;
}

/**
 * Check if connection appears to be local (not internet-facing)
 */
function isLocalNetworkConnection() {
  const interfaces = os.networkInterfaces();
  
  for (const name in interfaces) {
    for (const iface of interfaces[name]) {
      // Check for private network ranges
      if (iface.family === 'IPv4') {
        if (iface.address.startsWith('192.168.') ||
            iface.address.startsWith('10.') ||
            iface.address.startsWith('172.')) {
          return true;
        }
      }
    }
  }
  
  return false;
}

/**
 * Estimate if IBM i is directly reachable
 */
function canReachIbmiDirectly() {
  // This would be a ping-like check in real implementation
  // For now, check if IBM i connection vars are set
  return !!(process.env.ZEUS_FETCH_HOST || process.env.ZEUS_DB_HOST);
}

/**
 * Estimate bandwidth (placeholder)
 */
function estimateBandwidth() {
  // Would measure actual network bandwidth
  // For now, return placeholder
  return 'unknown';  // 'high' | 'medium' | 'low'
}

/**
 * Estimate latency (placeholder)
 */
function estimateLatency() {
  // Would measure actual network latency
  // For now, return placeholder
  return 'unknown';  // 'low' | 'medium' | 'high'
}

/**
 * Select optimal transport strategy based on environment
 * 
 * @param {Object} options User-provided options
 * @param {Object} networkProfile Network characteristics
 * @returns {Array} Transports in priority order
 */
function selectTransportStrategy(options, networkProfile) {
  // User explicitly requested a transport
  if (options.transport && options.transport !== 'auto') {
    return [options.transport];
  }
  
  // User preferences override automatic detection
  const strategies = [];
  
  if (options.preferJt400 || options.networkType === 'local') {
    strategies.push('jt400', 'sftp', 'ftp');
  } else if (options.preferSftp || options.networkType === 'internet' || options.encrypted) {
    strategies.push('sftp', 'jt400');
    // Don't use FTP if encryption is required
    if (!options.encrypted) {
      strategies.push('ftp');
    }
  } else if (options.ftpOnly) {
    strategies.push('ftp');
  } else {
    // Auto-detection based on network profile
    if (networkProfile.isLocalNetwork) {
      strategies.push('jt400', 'sftp', 'ftp');
    } else if (networkProfile.isEncryptionRequired) {
      strategies.push('sftp', 'jt400');
    } else {
      strategies.push('sftp', 'jt400', 'ftp');
    }
  }
  
  return strategies.filter(Boolean);
}

/**
 * Enhanced transport attempt with diagnostics
 * 
 * @param {Array} strategies Transport strategies to try
 * @param {Function} transportFn Function that tries a transport
 * @param {Object} options
 * @returns {Object} Result with diagnostics
 */
async function executeWithTransportDiagnostics(strategies, transportFn, options = {}) {
  const { verbose = false, timeout = 30000 } = options;
  
  const results = [];
  let lastError = null;
  
  for (const strategy of strategies) {
    const attemptStart = Date.now();
    
    if (verbose) {
      console.log(`[transport] Attempting: ${strategy}`);
      console.log(`[transport]   Profile: ${getTransportProfile(strategy)}`);
    }
    
    try {
      const result = await Promise.race([
        transportFn(strategy),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout (${timeout}ms)`)), timeout)
        )
      ]);
      
      const elapsed = Date.now() - attemptStart;
      
      if (verbose) {
        console.log(`[transport] ✅ ${strategy} succeeded (${elapsed}ms)`);
        if (result.downloadedCount) {
          console.log(`[transport]   Downloaded: ${result.downloadedCount} files`);
        }
      }
      
      return {
        success: true,
        transport: strategy,
        result,
        elapsedMs: elapsed,
        attempts: results.length + 1,
        diagnostics: results
      };
    } catch (error) {
      const elapsed = Date.now() - attemptStart;
      lastError = error;
      
      const attempt = {
        strategy,
        error: error.message,
        elapsedMs: elapsed,
        timeout: elapsed >= timeout
      };
      
      results.push(attempt);
      
      if (verbose) {
        console.log(`[transport] ❌ ${strategy} failed after ${elapsed}ms`);
        console.log(`[transport]   Error: ${error.message}`);
      }
    }
  }
  
  // All transports failed
  return {
    success: false,
    transport: null,
    result: null,
    attempts: results.length,
    diagnostics: results,
    lastError,
    recommendations: generateTransportRecommendations(results, lastError)
  };
}

function formatTransportAttempt(attempt) {
  const parts = [attempt.strategy];
  if (Number.isFinite(attempt.elapsedMs)) {
    parts.push(`${attempt.elapsedMs}ms`);
  }
  if (attempt.error) {
    parts.push(attempt.error);
  }
  return parts.join(' | ');
}

/**
 * Get human-readable transport profile description
 */
function getTransportProfile(transport) {
  const profile = TRANSPORT_PROFILES[transport];
  if (!profile) return 'unknown';
  
  return `${profile.name} (${profile.reliable ? 'reliable' : 'unreliable'}, ${profile.speed} speed)`;
}

/**
 * Generate user-friendly recovery recommendations
 */
function generateTransportRecommendations(attempts, lastError) {
  const recommendations = [];
  
  // All timed out? Network likely down
  const allTimedOut = attempts.every(a => a.timeout);
  if (allTimedOut) {
    recommendations.push(
      '🌐 Network timeout on all transports. Possible causes:',
      '   1. IBM i system is unreachable or offline',
      '   2. Network firewall is blocking connections',
      '   3. SSH/FTP services not running on IBM i',
      'Action: Check network connectivity, verify IBM i is running, check firewall rules'
    );
  }
  
  // SFTP failed specifically
  const sftpAttempt = attempts.find(a => a.strategy === 'sftp');
  if (sftpAttempt && sftpAttempt.error.includes('permission')) {
    recommendations.push(
      '🔐 SSH/SFTP permission denied. Possible causes:',
      '   1. SSH keys not authorized on IBM i',
      '   2. User password incorrect',
      '   3. SSH service not running',
      'Action: Verify SSH service, check credentials, check authorized_keys'
    );
  }
  
  // JT400 failed specifically
  const jt400Attempt = attempts.find(a => a.strategy === 'jt400');
  if (jt400Attempt && jt400Attempt.error.includes('JDBC')) {
    recommendations.push(
      '💾 JDBC/DB2 connection failed. Possible causes:',
      '   1. DB2 not running on IBM i',
      '   2. jt400.jar library missing or outdated',
      '   3. Incorrect JDBC URL',
      'Action: Check DB2 service, verify jt400 library, check JDBC connection string'
    );
  }
  
  if (recommendations.length === 0) {
    recommendations.push(
      'All transports failed. Common troubleshooting steps:',
      '   1. Verify IBM i system is online and responding',
      '   2. Check network connectivity and firewall rules',
      '   3. Verify SSH and FTP services are running',
      '   4. Check user credentials and permissions',
      '   5. Review ~/.ssh/config for SSH configuration issues'
    );
  }
  
  return recommendations;
}

/**
 * Pre-flight diagnostic check
 * Reports on available transports and their health
 */
async function runTransportDiagnostics(options = {}) {
  const { verbose = true } = options;
  
  const report = {
    timestamp: new Date().toISOString(),
    networkProfile: detectNetworkProfile(),
    strategyRecommendation: null,
    transportStatus: {},
    issues: [],
    recommendations: []
  };
  
  const networkProfile = report.networkProfile;
  
  // Report network characteristics
  if (verbose) {
    console.log('\n=== Transport Diagnostics ===\n');
    console.log('Network Profile:');
    console.log(`  Local Network: ${networkProfile.isLocalNetwork}`);
    console.log(`  Encryption Required: ${networkProfile.isEncryptionRequired}`);
    console.log(`  Direct IBM i Access: ${networkProfile.hasDirectIbmiAccess}`);
  }
  
  // Recommend strategy
  const strategies = selectTransportStrategy(options, networkProfile);
  report.strategyRecommendation = strategies;
  
  if (verbose) {
    console.log(`\nRecommended Transport Order: ${strategies.join(' → ')}`);
  }
  
  // Report on each transport
  for (const transport of Object.keys(TRANSPORT_PROFILES)) {
    const profile = TRANSPORT_PROFILES[transport];
    const status = {
      name: profile.name,
      recommended: strategies.includes(transport),
      encrypted: profile.encrypted,
      reliable: profile.reliable,
      speed: profile.speed
    };
    
    report.transportStatus[transport] = status;
    
    if (verbose && strategies.includes(transport)) {
      const index = strategies.indexOf(transport) + 1;
      console.log(`\n[${index}] ${profile.name}`);
      console.log(`    Speed: ${profile.speed}`);
      console.log(`    Encrypted: ${profile.encrypted}`);
      console.log(`    Reliable: ${profile.reliable}`);
    }
  }
  
  // Add recommendations if encryption required but not available
  if (networkProfile.isEncryptionRequired) {
    const nonEncrypted = Object.keys(TRANSPORT_PROFILES)
      .filter(t => !TRANSPORT_PROFILES[t].encrypted);
    
    if (nonEncrypted.length > 0) {
      report.recommendations.push(
        `⚠️  Encryption is required but ${nonEncrypted.join(', ')} are not encrypted. Skipping.`
      );
    }
  }
  
  return report;
}

module.exports = {
  detectNetworkProfile,
  selectTransportStrategy,
  executeWithTransportDiagnostics,
  formatTransportAttempt,
  generateTransportRecommendations,
  runTransportDiagnostics,
  TRANSPORT_PROFILES
};
