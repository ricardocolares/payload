/* eslint-disable @typescript-eslint/no-use-before-define */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable no-use-before-define */
import { GraphQLJSON } from 'graphql-type-json';
import {
  GraphQLBoolean, GraphQLEnumType,
  GraphQLFieldConfig,
  GraphQLFloat,
  GraphQLInt,
  GraphQLList,
  GraphQLObjectType,
  GraphQLString,
  GraphQLType,
  GraphQLUnionType,
} from 'graphql';
import { DateTimeResolver, EmailAddressResolver } from 'graphql-scalars';
import { Field, RadioField, RelationshipField, SelectField, UploadField, ArrayField, GroupField, RichTextField, fieldAffectsData, NumberField, TextField, EmailField, TextareaField, CodeField, DateField, PointField, CheckboxField, BlockField, RowField, fieldIsPresentationalOnly, CollapsibleField, TabsField } from '../../fields/config/types';
import formatName from '../utilities/formatName';
import combineParentName from '../utilities/combineParentName';
import withNullableType from './withNullableType';
import { toWords } from '../../utilities/formatLabels';
import createRichTextRelationshipPromise from '../../fields/richText/relationshipPromise';
import formatOptions from '../utilities/formatOptions';
import { Payload } from '../..';
import find from '../../collections/operations/find';
import buildWhereInputType from './buildWhereInputType';
import buildBlockType from './buildBlockType';

type LocaleInputType = {
  locale: {
    type: GraphQLType;
  },
  fallbackLocale: {
    type: GraphQLType;
  },
  where: {
    type: GraphQLType;
  }
}

export type ObjectTypeConfig = {
  [path: string]: GraphQLFieldConfig<any, any>
}

function buildObjectType(payload: Payload, name: string, fields: Field[], parentName: string, baseFields: ObjectTypeConfig = {}): GraphQLObjectType {
  const fieldToSchemaMap = {
    number: (objectTypeConfig: ObjectTypeConfig, field: NumberField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, GraphQLFloat) },
    }),
    text: (objectTypeConfig: ObjectTypeConfig, field: TextField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, GraphQLString) },
    }),
    email: (objectTypeConfig: ObjectTypeConfig, field: EmailField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, EmailAddressResolver) },
    }),
    textarea: (objectTypeConfig: ObjectTypeConfig, field: TextareaField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, GraphQLString) },
    }),
    code: (objectTypeConfig: ObjectTypeConfig, field: CodeField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, GraphQLString) },
    }),
    date: (objectTypeConfig: ObjectTypeConfig, field: DateField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, DateTimeResolver) },
    }),
    point: (objectTypeConfig: ObjectTypeConfig, field: PointField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, new GraphQLList(GraphQLFloat)) },
    }),
    richText: (objectTypeConfig: ObjectTypeConfig, field: RichTextField) => ({
      ...objectTypeConfig,
      [field.name]: {
        type: withNullableType(field, GraphQLJSON),
        async resolve(parent, args, context) {
          if (args.depth > 0) {
            await createRichTextRelationshipPromise({
              req: context.req,
              siblingDoc: parent,
              depth: args.depth,
              field,
              showHiddenFields: false,
            });
          }

          return parent[field.name];
        },
        args: {
          depth: {
            type: GraphQLInt,
          },
        },
      },
    }),
    upload: (objectTypeConfig: ObjectTypeConfig, field: UploadField) => {
      const { relationTo, label } = field;

      const uploadName = combineParentName(parentName, label === false ? toWords(field.name, true) : label);

      // If the relationshipType is undefined at this point,
      // it can be assumed that this blockType can have a relationship
      // to itself. Therefore, we set the relationshipType equal to the blockType
      // that is currently being created.

      const type = payload.collections[relationTo].graphQL.type || newlyCreatedBlockType;

      const uploadArgs = {} as LocaleInputType;

      if (payload.config.localization) {
        uploadArgs.locale = {
          type: payload.types.localeInputType,
        };

        uploadArgs.fallbackLocale = {
          type: payload.types.fallbackLocaleInputType,
        };
      }

      const relatedCollectionSlug = field.relationTo;

      const upload = {
        args: uploadArgs,
        type,
        extensions: { complexity: 20 },
        async resolve(parent, args, context) {
          const value = parent[field.name];
          const locale = args.locale || context.req.locale;
          const fallbackLocale = args.fallbackLocale || context.req.fallbackLocale;
          const id = value;

          if (id) {
            const relatedDocument = await context.req.payloadDataLoader.load(JSON.stringify([
              relatedCollectionSlug,
              id,
              0,
              0,
              locale,
              fallbackLocale,
              false,
              false,
            ]));

            return relatedDocument || null;
          }

          return null;
        },
      };

      const whereFields = payload.collections[relationTo].config.fields;

      upload.args.where = {
        type: buildWhereInputType(
          uploadName,
          whereFields,
          uploadName,
        ),
      };

      return {
        ...objectTypeConfig,
        [field.name]: upload,
      };
    },
    radio: (objectTypeConfig: ObjectTypeConfig, field: RadioField) => ({
      ...objectTypeConfig,
      [field.name]: {
        type: withNullableType(
          field,
          new GraphQLEnumType({
            name: combineParentName(parentName, field.name),
            values: formatOptions(field),
          }),
        ),
      },
    }),
    checkbox: (objectTypeConfig: ObjectTypeConfig, field: CheckboxField) => ({
      ...objectTypeConfig,
      [field.name]: { type: withNullableType(field, GraphQLBoolean) },
    }),
    select: (objectTypeConfig: ObjectTypeConfig, field: SelectField) => {
      const fullName = combineParentName(parentName, field.name);

      let type: GraphQLType = new GraphQLEnumType({
        name: fullName,
        values: formatOptions(field),
      });

      type = field.hasMany ? new GraphQLList(type) : type;
      type = withNullableType(field, type);

      return {
        ...objectTypeConfig,
        [field.name]: { type },
      };
    },
    relationship: (objectTypeConfig: ObjectTypeConfig, field: RelationshipField) => {
      const { relationTo, label } = field;
      const isRelatedToManyCollections = Array.isArray(relationTo);
      const hasManyValues = field.hasMany;
      const relationshipName = combineParentName(parentName, label === false ? toWords(field.name, true) : label);

      let type;
      let relationToType = null;

      if (Array.isArray(relationTo)) {
        relationToType = new GraphQLEnumType({
          name: `${relationshipName}_RelationTo`,
          values: relationTo.reduce((relations, relation) => ({
            ...relations,
            [formatName(relation)]: {
              value: relation,
            },
          }), {}),
        });

        const types = relationTo.map((relation) => payload.collections[relation].graphQL.type);

        type = new GraphQLObjectType({
          name: `${relationshipName}_Relationship`,
          fields: {
            relationTo: {
              type: relationToType,
            },
            value: {
              type: new GraphQLUnionType({
                name: relationshipName,
                types,
                async resolveType(data, { req }) {
                  return payload.collections[data.collection].graphQL.type.name;
                },
              }),
            },
          },
        });
      } else {
        ({ type } = payload.collections[relationTo as string].graphQL);
      }

      // If the relationshipType is undefined at this point,
      // it can be assumed that this blockType can have a relationship
      // to itself. Therefore, we set the relationshipType equal to the blockType
      // that is currently being created.

      type = type || newlyCreatedBlockType;

      const relationshipArgs: {
        locale?: unknown
        fallbackLocale?: unknown
        where?: unknown
        page?: unknown
        limit?: unknown
      } = {};

      if (payload.config.localization) {
        relationshipArgs.locale = {
          type: payload.types.localeInputType,
        };

        relationshipArgs.fallbackLocale = {
          type: payload.types.fallbackLocaleInputType,
        };
      }

      const relationship = {
        args: relationshipArgs,
        type: hasManyValues ? new GraphQLList(type) : type,
        extensions: { complexity: 10 },
        async resolve(parent, args, context) {
          const value = parent[field.name];
          const locale = args.locale || context.req.locale;
          const fallbackLocale = args.fallbackLocale || context.req.fallbackLocale;
          let relatedCollectionSlug = field.relationTo;

          if (hasManyValues) {
            const results = [];
            const resultPromises = [];

            const createPopulationPromise = async (relatedDoc, i) => {
              let id = relatedDoc;
              let collectionSlug = field.relationTo;

              if (isRelatedToManyCollections) {
                collectionSlug = relatedDoc.relationTo;
                id = relatedDoc.value;
              }

              const result = await context.req.payloadDataLoader.load(JSON.stringify([
                collectionSlug,
                id,
                0,
                0,
                locale,
                fallbackLocale,
                false,
                false,
              ]));

              if (result) {
                if (isRelatedToManyCollections) {
                  results[i] = {
                    relationTo: collectionSlug,
                    value: {
                      ...result,
                      collection: collectionSlug,
                    },
                  };
                } else {
                  results[i] = result;
                }
              }
            };

            if (value) {
              value.forEach((relatedDoc, i) => {
                resultPromises.push(createPopulationPromise(relatedDoc, i));
              });
            }

            await Promise.all(resultPromises);
            return results;
          }

          let id = value;
          if (isRelatedToManyCollections && value) {
            id = value.value;
            relatedCollectionSlug = value.relationTo;
          }

          if (id) {
            id = id.toString();

            const relatedDocument = await context.req.payloadDataLoader.load(JSON.stringify([
              relatedCollectionSlug,
              id,
              0,
              0,
              locale,
              fallbackLocale,
              false,
              false,
            ]));

            if (relatedDocument) {
              if (isRelatedToManyCollections) {
                return {
                  relationTo: relatedCollectionSlug,
                  value: {
                    ...relatedDocument,
                    collection: relatedCollectionSlug,
                  },
                };
              }

              return relatedDocument;
            }

            return null;
          }

          return null;
        },
      };

      return {
        ...objectTypeConfig,
        [field.name]: relationship,
      };
    },
    array: (objectTypeConfig: ObjectTypeConfig, field: ArrayField) => {
      const fullName = combineParentName(parentName, field.label === false ? toWords(field.name, true) : field.label);
      const type = buildObjectType(payload, fullName, field.fields, fullName);
      const arrayType = new GraphQLList(withNullableType(field, type));

      return {
        ...objectTypeConfig,
        [field.name]: { type: arrayType },
      };
    },
    group: (objectTypeConfig: ObjectTypeConfig, field: GroupField) => {
      const fullName = combineParentName(parentName, field.label === false ? toWords(field.name, true) : field.label);
      const type = buildObjectType(payload, fullName, field.fields, fullName);

      return {
        ...objectTypeConfig,
        [field.name]: { type },
      };
    },
    blocks: (objectTypeConfig: ObjectTypeConfig, field: BlockField) => {
      const blockTypes = field.blocks.map((block) => {
        buildBlockType(payload, block);
        return payload.types.blockTypes[block.slug];
      });

      const fullName = combineParentName(parentName, field.label === false ? toWords(field.name, true) : field.label);

      const type = new GraphQLList(new GraphQLUnionType({
        name: fullName,
        types: blockTypes,
        resolveType: (data) => payload.types.blockTypes[data.blockType].name,
      }));

      return {
        ...objectTypeConfig,
        [field.name]: { type },
      };
    },
    row: (objectTypeConfig: ObjectTypeConfig, field: RowField) => field.fields.reduce((objectTypeConfigWithRowFields, subField) => {
      const addSubField = fieldToSchemaMap[subField.type];
      return addSubField(objectTypeConfigWithRowFields, subField);
    }, objectTypeConfig),
    collapsible: (objectTypeConfig: ObjectTypeConfig, field: CollapsibleField) => field.fields.reduce((objectTypeConfigWithCollapsibleFields, subField) => {
      const addSubField = fieldToSchemaMap[subField.type];
      return addSubField(objectTypeConfigWithCollapsibleFields, subField);
    }, objectTypeConfig),
    tabs: (objectTypeConfig: ObjectTypeConfig, field: TabsField) => field.tabs.reduce((tabSchema, tab) => {
      return {
        ...tabSchema,
        ...tab.fields.reduce((subFieldSchema, subField) => {
          const addSubField = fieldToSchemaMap[subField.type];
          return addSubField(subFieldSchema, subField);
        }, tabSchema),
      };
    }, objectTypeConfig),
  };

  const objectSchema = {
    name,
    fields: () => fields.reduce((objectTypeConfig, field) => {
      const fieldSchema = fieldToSchemaMap[field.type];

      if (typeof fieldSchema !== 'function') {
        return objectTypeConfig;
      }

      return {
        ...objectTypeConfig,
        ...fieldSchema(objectTypeConfig, field),
      };
    }, baseFields),
  };

  const newlyCreatedBlockType = new GraphQLObjectType(objectSchema);

  return newlyCreatedBlockType;
}

export default buildObjectType;
