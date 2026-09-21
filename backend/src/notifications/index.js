'use strict';

const { NOTIFICATION_TYPES, PREF_KEYS, DOMAIN_TO_NOTIFICATION, DOMAIN_PUSH_TYPES } = require('./types');
const templates = require('./templates');
const { createRecipientResolver } = require('./resolver');
const { createNotificationService } = require('./service');
const { mountNotificationRoutes } = require('./routes');

module.exports = {
  NOTIFICATION_TYPES,
  PREF_KEYS,
  DOMAIN_TO_NOTIFICATION,
  DOMAIN_PUSH_TYPES,
  templates,
  createRecipientResolver,
  createNotificationService,
  mountNotificationRoutes
};
