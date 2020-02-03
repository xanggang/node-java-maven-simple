const webpack = require('webpack')
const config = require('./webpack.config.dev')

webpack(config, (err, status) => {
  if (err) throw err
  console.log('构建完成');
})
