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
//
// ajv is the SOLE external dependency, and a Claude Code plugin/marketplace
// install does NOT run `npm install` — so node_modules (hence ajv) can be absent
// at runtime. Load it OPTIONALLY: with ajv present (dev/CI, and any npm-installed
// checkout) the schema is fully enforced; without it the state store still LOADS
// and works in a degraded mode that skips structural validation rather than
// crashing. This matters because nearly every hook and the escc CLI transitively
// require this module — a hard `require('ajv')` here would take the whole
// state-backed machinery down, including the fail-closed outbound send-gate.
let Ajv = null;
try {
  const ajv2020 = require('ajv/dist/2020');
  Ajv = ajv2020.default || ajv2020;
} catch (_err) {
  Ajv = null;
}

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
  doNotContact: 'doNotContact',
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
  // Degraded mode: ajv unavailable → skip validation (never crash). See the
  // optional-load note above. Entities reaching this layer are constructed
  // internally (not from untrusted input), so skipping the structural check in a
  // bare runtime is safe; a normal install with ajv still enforces the schema.
  if (!Ajv) {
    return { valid: true, errors: [] };
  }
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
