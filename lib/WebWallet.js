'use strict'

const express = require('express')
const bodyParser = require('body-parser')
const socketIO = require('socket.io')
const fs = require('fs')
const R = require('ramda')

const Component = require('./Component')

const BASE_PATH = __dirname + '/../templates/'

class WebWallet extends Component {

  constructor() {
    super()
    this.module = 'WWL'
    this.ready = false
    
    this.app = express()
    this.app.use(bodyParser.urlencoded({extended: false}))
    this.server = this.app.listen(7439 /*, 'localhost' */)
    this.io = socketIO.listen(this.server)
    
    this.app.get('/assets/*', (req, res) => {
      const url = req.params[0]
      if (R.contains(url, ['bootstrap.min.css'])) {
        res.set('Content-type', 'text/css')
        res.send(fs.readFileSync(BASE_PATH + url, 'utf8'))
      } else if (R.contains(url, ['jquery.min.js', 'bootstrap.min.js', 'jquery.noty.packaged.min.js'])) {
        res.set('Content-type', 'application/javascript')
        res.send(fs.readFileSync(BASE_PATH + url, 'utf8'))
      }
    })
    this.app.get('/', (req, res) => {
      if (this.ready) {
        res.send(fs.readFileSync(BASE_PATH + 'index.html', 'utf8').replace('%LOGIN%', 'Wallet'))
      } else {
        res.send(fs.readFileSync(BASE_PATH + 'sync.html', 'utf8'))
      }
    })
  }
  
  setReady(ready = true) {
    this.ready = ready
  }
}

const webWallet = new WebWallet
module.exports = webWallet