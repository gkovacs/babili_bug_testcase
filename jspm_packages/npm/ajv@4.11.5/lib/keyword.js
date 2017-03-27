/* */ 
'use strict';
var IDENTIFIER = /^[a-z_$][a-z0-9_$\-]*$/i;
var customRuleCode = require('./dotjs/custom');
module.exports = {
  add: addKeyword,
  get: getKeyword,
  remove: removeKeyword
};
function addKeyword(keyword, definition) {
  var RULES = this.RULES;
  if (RULES.keywords[keyword])
    throw new Error('Keyword ' + keyword + ' is already defined');
  if (!IDENTIFIER.test(keyword))
    throw new Error('Keyword ' + keyword + ' is not a valid identifier');
  if (definition) {
    if (definition.macro && definition.valid !== undefined)
      throw new Error('"valid" option cannot be used with macro keywords');
    var dataType = definition.type;
    if (Array.isArray(dataType)) {
      var i,
          len = dataType.length;
      for (i = 0; i < len; i++)
        checkDataType(dataType[i]);
      for (i = 0; i < len; i++)
        _addRule(keyword, dataType[i], definition);
    } else {
      if (dataType)
        checkDataType(dataType);
      _addRule(keyword, dataType, definition);
    }
    var $data = definition.$data === true && this._opts.v5;
    if ($data && !definition.validate)
      throw new Error('$data support: "validate" function is not defined');
    var metaSchema = definition.metaSchema;
    if (metaSchema) {
      if ($data) {
        metaSchema = {anyOf: [metaSchema, {'$ref': 'https://raw.githubusercontent.com/epoberezkin/ajv/master/lib/refs/json-schema-v5.json#/definitions/$data'}]};
      }
      definition.validateSchema = this.compile(metaSchema, true);
    }
  }
  RULES.keywords[keyword] = RULES.all[keyword] = true;
  function _addRule(keyword, dataType, definition) {
    var ruleGroup;
    for (var i = 0; i < RULES.length; i++) {
      var rg = RULES[i];
      if (rg.type == dataType) {
        ruleGroup = rg;
        break;
      }
    }
    if (!ruleGroup) {
      ruleGroup = {
        type: dataType,
        rules: []
      };
      RULES.push(ruleGroup);
    }
    var rule = {
      keyword: keyword,
      definition: definition,
      custom: true,
      code: customRuleCode
    };
    ruleGroup.rules.push(rule);
    RULES.custom[keyword] = rule;
  }
  function checkDataType(dataType) {
    if (!RULES.types[dataType])
      throw new Error('Unknown type ' + dataType);
  }
}
function getKeyword(keyword) {
  var rule = this.RULES.custom[keyword];
  return rule ? rule.definition : this.RULES.keywords[keyword] || false;
}
function removeKeyword(keyword) {
  var RULES = this.RULES;
  delete RULES.keywords[keyword];
  delete RULES.all[keyword];
  delete RULES.custom[keyword];
  for (var i = 0; i < RULES.length; i++) {
    var rules = RULES[i].rules;
    for (var j = 0; j < rules.length; j++) {
      if (rules[j].keyword == keyword) {
        rules.splice(j, 1);
        break;
      }
    }
  }
}
