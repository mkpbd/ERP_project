import { testEnvironment } from './test-env.js';

Object.assign(process.env, testEnvironment());
