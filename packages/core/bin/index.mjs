#!/usr/bin/env node

import path from 'path';
import fs from 'fs';
import {fileURLToPath} from 'url';
import webpack from 'webpack';
import WebpackDevServer from 'webpack-dev-server';
import HtmlWebpackPlugin from 'html-webpack-plugin';
import meow from 'meow';
import UIPlugin from './plugins/UIPlugin.mjs';
import {createRequire} from 'module';
import {metaImportTransformer} from './transformers/metaImportTransformer.mjs';

const cli = meow({
  importMeta: import.meta,
  flags: {
    uiServer: {
      type: 'boolean',
      default: false,
    },
    uiPath: {
      type: 'string',
      default: '',
    },
    output: {
      type: 'string',
      alias: 'o',
      default: 'output',
    },
  },
});

if (cli.flags.uiServer) {
  cli.flags.uiPath ||= 'http://localhost:9001/main.js';
} else {
  if (cli.flags.uiPath) {
    cli.flags.uiPath = path.resolve(cli.flags.uiPath);
  } else {
    const require = createRequire(import.meta.url);
    cli.flags.uiPath = path.dirname(require.resolve('@motion-canvas/ui'));
  }
}

const META_VERSION = 1;

const projectFile = path.resolve(cli.input[0]);
const renderOutput = path.resolve(cli.flags.output);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJSON = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'),
);

const compiler = webpack({
  entry: {project: projectFile},
  mode: 'development',
  devtool: 'inline-source-map',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        loader: 'ts-loader',
        options: {
          getCustomTransformers: () => ({
            before: [
              metaImportTransformer({
                project: projectFile,
                version: META_VERSION,
              }),
            ],
          }),
        },
      },
      {
        test: /\.meta/i,
        loader: 'meta-loader',
      },
      {
        test: /\.(wav|mp3|ogg|mp4)$/i,
        type: 'asset',
      },
      {
        test: /\.(png|jpe?g)$/i,
        oneOf: [
          {
            resourceQuery: /img/,
            loader: 'image-loader',
          },
          {
            resourceQuery: /anim/,
            loader: 'animation-loader',
          },
          {
            type: 'asset',
          },
        ],
      },
      {
        test: /\.csv$/,
        loader: 'csv-loader',
        options: {
          dynamicTyping: true,
          header: true,
          skipEmptyLines: true,
        },
      },
      {
        test: /\.glsl$/i,
        type: 'asset/source',
      },
    ],
  },
  resolveLoader: {
    modules: ['node_modules', path.resolve(__dirname, './loaders')],
  },
  resolve: {
    extensions: ['.js', '.ts', '.tsx'],
  },
  output: {
    filename: `[name].js`,
    publicPath: '/',
    path: __dirname,
  },
  plugins: [
    new webpack.ProvidePlugin({
      // Required to load additional languages for Prism
      Prism: 'prismjs',
    }),
    new webpack.DefinePlugin({
      PROJECT_FILE_NAME: `'${path.parse(projectFile).name}'`,
      CORE_VERSION: `'${packageJSON.version}'`,
      META_VERSION,
    }),
    new HtmlWebpackPlugin({title: 'Motion Canvas'}),
    new UIPlugin(cli.flags),
  ],
});

const server = new WebpackDevServer(
  {
    compress: true,
    port: 9000,
    hot: true,
    static: [
      {
        directory: path.join(__dirname, '../api'),
        publicPath: '/api',
        watch: false,
      },
    ],
    setupMiddlewares: middlewares => {
      middlewares.unshift({
        name: 'render',
        path: '/render/:name',
        middleware: (req, res) => {
          const file = path.join(renderOutput, req.params.name);
          const directory = path.dirname(file);
          if (!fs.existsSync(directory)) {
            fs.mkdirSync(directory, {recursive: true});
          }
          const stream = fs.createWriteStream(file, {encoding: 'base64'});
          req.pipe(stream);
          req.on('end', () => res.end());
        },
      });

      middlewares.unshift({
        name: 'meta',
        path: '/meta/:source',
        middleware: (req, res) => {
          const stream = fs.createWriteStream(
            path.join(compiler.context, req.params.source),
            {encoding: 'utf8'},
          );
          req.pipe(stream);
          req.on('end', () => res.end());
        },
      });

      if (!cli.flags.uiServer) {
        middlewares.unshift({
          name: 'ui',
          path: '/ui/:name',
          middleware: (req, res) => {
            fs.createReadStream(path.join(cli.flags.uiPath, req.params.name), {
              encoding: 'utf8',
            })
              .on('error', () => res.sendStatus(404))
              .pipe(res);
          },
        });
      }

      return middlewares;
    },
  },
  compiler,
);
server.start().catch(console.error);