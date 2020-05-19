/* eslint-disable no-param-reassign */
module.exports = {
  slug: 'hooks',
  labels: {
    singular: 'Hook',
    plural: 'Hooks',
  },
  useAsTitle: 'title',
  policies: {
    create: () => true,
    read: () => true,
    update: () => true,
    delete: () => true,
  },
  hooks: {
    beforeCreate: (operation) => {
      if (operation.req.headers.hook === 'beforeCreate') {
        operation.req.body.description += '-beforeCreateSuffix';
      }
      return operation;
    },
    beforeRead: (operation) => {
      if (operation.req.headers.hook === 'beforeRead') {
        operation.limit = 1;
      }
      return operation;
    },
    beforeUpdate: (operation) => {
      if (operation.req.headers.hook === 'beforeUpdate') {
        operation.req.body.description += '-beforeUpdateSuffix';
      }
      return operation;
    },
    beforeDelete: (operation) => {
      if (operation.req.headers.hook === 'beforeDelete') {
        // TODO: Find a better hook operation to assert against in tests
        operation.req.headers.hook = 'afterDelete';
      }
      return operation;
    },
    afterCreate: (operation, value) => {
      if (operation.req.headers.hook === 'afterCreate') {
        value.afterCreateHook = true;
      }
      return value;
    },
    afterRead: (operation) => {
      const { json } = operation;
      json.afterReadHook = true;
    },
    afterUpdate: (operation, value) => {
      if (operation.req.headers.hook === 'afterUpdate') {
        value.afterUpdateHook = true;
      }
      return value;
    },
    afterDelete: (operation, value) => {
      if (operation.req.headers.hook === 'afterDelete') {
        value.afterDeleteHook = true;
      }
      return value;
    },
  },
  fields: [
    {
      name: 'title',
      label: 'Title',
      type: 'text',
      maxLength: 100,
      required: true,
      unique: true,
      localized: true,
    },
    {
      name: 'description',
      label: 'Description',
      type: 'textarea',
      height: 100,
      required: true,
      localized: true,
    },
  ],
  timestamps: true,
};