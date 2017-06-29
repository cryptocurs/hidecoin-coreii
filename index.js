'use strict'

const storage = require('./lib/Storage')
storage.init({
  base: __dirname + '/data/',
  path: 'storage.json',
  pathInit: 'init-storage.json'
})

storage.config = require('./config.json')

require('./lib/App').run()