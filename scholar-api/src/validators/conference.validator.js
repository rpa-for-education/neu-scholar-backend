import Joi from "joi";

export const conferenceSchema = Joi.object({
  _key: Joi.string().required(),
  name: Joi.string().required(),
  acronym: Joi.string().required(),
  country: Joi.string().required(),
  start_date: Joi.string().required()
});