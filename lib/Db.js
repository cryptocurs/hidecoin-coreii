'use strict'

const R = require('ramda')
const sqlite = require('sqlite3').verbose()

const {Asyncs, Files} = require('./helpers')
const Component = require('./Component')
const storage = require('./Storage')

const BASE_PATH = __dirname + '/../data/'
const FILE_NAME = 'blocks.db'
const PATH_BLOCKS = BASE_PATH + FILE_NAME

class Db extends Component {

  constructor() {
    super()
    this.module = 'SQL'
    this.bigQueries = {}
    this.db = new sqlite.Database(PATH_BLOCKS)
    this.createTables()
    this.log('Runned')
  }
  
  query(...args) {
    return new Promise((resolve, reject) => {
      this.db.run(...args, (err) => {
        if (err) {
          storage.emit('fatalError', 'SQLite error: ' + err)
        }
        resolve()
      })
    })
  }
  
  prepare(text) {
    return new Promise((resolve, reject) => {
      const stmt = db.prepare(text)
      resolve(stmt, () => {
        stmt.finalize()
      })
    })
  }
  
  run(stmt, values) {
    return new Promise((resolve, reject) => {
      stmt.run(values, (err) => {
        if (err) {
          storage.emit('fatalError', 'SQLite error: ' + err)
        }
        resolve()
      })
    })
  }
  
  each(text, values, itemCallback, returnCallback) {
    this.db.each(text, values, (err, row) => {
      if (err) {
        storage.emit('fatalError', 'SQLite error: ' + err)
      }
      itemCallback(row)
    }, (err, rowCount) => {
      if (err) {
        storage.emit('fatalError', 'SQLite error: ' + err)
      }
      returnCallback && returnCallback(rowCount)
    })
  }
  
  begin() {
    return db.query("BEGIN")
  }
  
  commit() {
    return db.query("COMMIT")
  }
  
  bigQueryStart(text, tail, delimiter) {
    this.bigQueries[text] = {
      delimiter,
      tail,
      queries: [],
      values: []
    }
  }
  
  bigQueryRun(text) {
    return new Promise((resolve, reject) => {
      const {delimiter, queries, values} = this.bigQueries[text]
      if (queries.length) {
        const bigText = text + R.join(delimiter, queries)
        const valuesCopy = values.slice()
        queries.length = 0
        values.length = 0
        db.query(bigText, valuesCopy).then(() => resolve())
      } else {
        resolve()
      }
    })
  }
  
  bigQueryRunAll() {
    return new Promise((resolve, reject) => {
      Asyncs.forEach(this.bigQueries, (bigQuery, text, next) => {
        this.bigQueryRun(text).then(() => next())
      }, () => resolve())
    })
  }
  
  bigQueryPush(text, values) {
    return new Promise((resolve, reject) => {
      const bigQuery = this.bigQueries[text]
      bigQuery.queries.push(bigQuery.tail)
      bigQuery.values = [...bigQuery.values, ...values]
      if (bigQuery.queries.length >= 128) {
        this.bigQueryRun(text).then(() => resolve())
      } else {
        resolve()
      }
    })
  }
  
  bigQueryEnd(text) {
    return new Promise((resolve, reject) => {
      this.bigQueryRun(text).then(() => {
        delete this.bigQueries[text]
        resolve()
      })
    })
  }
  
  createTables() {
    return new Promise((resolve, reject) => {
      this.query("CREATE TABLE IF NOT EXISTS txs (id INTEGER PRIMARY KEY, block_height INTEGER, hash TEXT)")
        .then(() => this.query("CREATE TABLE IF NOT EXISTS outs (id INTEGER PRIMARY KEY, block_height INTEGER, tx_hash TEXT, out_n INTEGER, address TEXT, amount INTEGER, spent_at INTEGER)"))
        .then(() => resolve())
    })
  }
  
  clear() {
    return new Promise((resolve, reject) => {
      this.query("DROP TABLE txs")
        .then(() => this.query("DROP TABLE outs"))
        .then(() => this.createTables())
        .then(() => resolve())
    })
  }
  
  saveCheckpoint(path) {
    return new Promise((resolve, reject) => {
      Files.copy(PATH_BLOCKS, path + FILE_NAME)
        .then(() => resolve())
    })
  }
  
  loadCheckpoint(path) {
    return new Promise((resolve, reject) => {
      Files.copyBack(PATH_BLOCKS, path + FILE_NAME)
        .then(() => {
          this.db = new sqlite.Database(PATH_BLOCKS)
          resolve()
        })
    })
  }
}

const db = new Db
module.exports = db