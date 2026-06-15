/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/state-store/schema.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*. Part of the JSONL rewrite of the ECC
 * sql.js-backed state-store: the schema/validation layer is preserved
 * verbatim in contract (same exports + behavior) and extended with the
 * ESCC promise/forecastSnapshot/outcome entities.
 */

'use strict';

const fs = require('fs');
const path = require('path');
// The state-store schema is JSON Schema draft 2020-12, so use ajv's bundled
// 2020 build (ships inside the ajv package — no additional dependency).
const ajv2020 = require('ajv/dist/2020');
const Ajv = ajv2020.default || ajv2020;

const SCHEMA_PATH = path.join(__dirname, '..', '..', '..', 'schemas', 'state-store.schema.json');

const ENTITY_DEFINITIONS = {
  session: 'session',
  skillRun: 'skillRun',
  skillVersion: 'skillVersion',
  decision: 'decision',
  installState: 'installState',
  governanceEvent: 'governanceEvent',
  workItem: 'workItem',
  promise: 'promise',
  forecastSnapshot: 'forecastSnapshot',
  outcome: 'outcome',
};

let cachedSchema = null;
let cachedAjv = null;
const cachedValidators = new Map();

function readSchema() {
  if (cachedSchema) {
    return cachedSchema;
  }

  cachedSchema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return cachedSchema;
}

function getAjv() {
  if (cachedAjv) {
    return cachedAjv;
  }

  cachedAjv = new Ajv({
    allErrors: true,
    strict: false,
  });
  return cachedAjv;
}

function getEntityValidator(entityName) {
  if (cachedValidators.has(entityName)) {
    return cachedValidators.get(entityName);
  }

  const schema = readSchema();
  const definitionName = ENTITY_DEFINITIONS[entityName];

  if (!definitionName || !schema.$defs || !schema.$defs[definitionName]) {
    throw new Error(`Unknown state-store schema entity: ${entityName}`);
  }

  const validatorSchema = {
    $schema: schema.$schema,
    ...schema.$defs[definitionName],
    $defs: schema.$defs,
  };
  const validator = getAjv().compile(validatorSchema);
  cachedValidators.set(entityName, validator);
  return validator;
}

function formatValidationErrors(errors = []) {
  return errors
    .map(error => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

function validateEntity(entityName, payload) {
  const validator = getEntityValidator(entityName);
  const valid = validator(payload);
  return {
    valid,
    errors: validator.errors || [],
  };
}

function assertValidEntity(entityName, payload, label) {
  const result = validateEntity(entityName, payload);
  if (!result.valid) {
    throw new Error(`Invalid ${entityName}${label ? ` (${label})` : ''}: ${formatValidationErrors(result.errors)}`);
  }
}

module.exports = {
  assertValidEntity,
  formatValidationErrors,
  readSchema,
  validateEntity,
};
