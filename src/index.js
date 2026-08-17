'use strict';

// Unified programmatic entry point for the public package. The CLI remains the
// package main entry; this file gives integrated modules one stable API surface.
const api = require('./api/zeusApi');
const entitlement = require('./entitlement');
const generationAssurance = require('./generationAssurance');
const db2TestIntelligence = require('./db2TestIntelligence');
const db2TestIntelligenceConstants = require('./db2TestIntelligence/constants');
const db2TestIntelligenceRegistration = require('./db2TestIntelligence/register');
const ibmiValidation = require('./ibmiValidation');
const builtInModules = require('./modules/builtInModules');
const productSurface = require('./modules/productSurface');
const referenceModule = require('./modules/referenceModule/register');

module.exports = {
  ...api,
  ...entitlement,
  entitlement,
  generationAssurance,
  db2TestIntelligence,
  ibmiValidation,
  builtInModules,
  productSurface,
  ...generationAssurance,
  ...db2TestIntelligence,
  ...ibmiValidation,
  ...builtInModules,
  ...productSurface,
  ...require('./projectIntelligence/entitled'),
  registerGenerationAssuranceModule: generationAssurance.registerGenerationAssuranceModule,
  GENERATION_ASSURANCE_MODULE_ID: generationAssurance.MODULE_ID,
  GENERATION_ASSURANCE_CAPABILITY_ID: generationAssurance.CAPABILITY_ID,
  GENERATION_ASSURANCE_STOP_CODES: generationAssurance.STOP_CODES,
  GENERATION_ASSURANCE_CONTRACT_REF: generationAssurance.CONTRACT_REF,
  registerDb2TestIntelligenceModule:
    db2TestIntelligenceRegistration.registerDb2TestIntelligenceModule,
  DB2_TEST_INTELLIGENCE_MODULE_ID: db2TestIntelligenceConstants.MODULE_ID,
  DB2_TEST_INTELLIGENCE_CAPABILITY_ID: db2TestIntelligenceConstants.CAPABILITY_ID,
  DB2_TEST_INTELLIGENCE_RESULT_CONTRACT_REF: db2TestIntelligenceConstants.RESULT_CONTRACT_REF,
  registerReferenceModule: referenceModule.registerReferenceModule,
  REFERENCE_MODULE_ID: referenceModule.MODULE_ID,
  REFERENCE_CAPABILITY_ID: referenceModule.CAPABILITY_ID,
  CAPABILITY_ID: referenceModule.CAPABILITY_ID,
  REASON_CODES: entitlement.REASON_CODES,
  PROJECT_INTELLIGENCE_MODULE_ID: require('./projectIntelligence/entitled').MODULE_ID,
  PROJECT_INTELLIGENCE_CAPABILITY_IDS: require('./projectIntelligence/entitled').CAPABILITY_IDS,
  PROJECT_INTELLIGENCE_NON_CLAIMS: require('./projectIntelligence/entitled').NON_CLAIMS,
  registerBuiltInModules: builtInModules.registerWithZeus,
};
