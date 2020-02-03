const path = require('path')
const webpack = require('webpack')

const devConfig = {
  mode: 'development',
  devtool: 'cheap-module-source-map',
  entry: path.join(__dirname, '../index.js'),
  output: {
    filename: 'index.js',
    path: path.join(__dirname, '../dist'),
    publicPath: '/',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: [
      '.js',
    ]
  },
  module: {
    rules: [
      {
        test: /\.(js|jsx)$/,
        exclude: /node_modules/,
        loader: 'babel-loader'
      }
    ]
  },
  plugins: [],
  target: 'node',
}

module.exports = devConfig
