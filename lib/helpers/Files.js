'use strict'

const fs = require('fs')

module.exports = new class Files {

  needDir(path, callback) {
    if (fs.existsSync(path)) {
      callback && callback()
    } else {
      fs.mkdir(path, (err) => {
        if (err) {
          throw err
        }
        callback && callback()
      })
    }
  }
  
  copy(src, dst, callback) {
    return new Promise((resolve, reject) => {
      fs.readFile(src, (err, data) => {
        if (err) {
          throw err
        }
        fs.writeFile(dst, data, (err) => {
          if (err) {
            throw err
          }
          resolve(true)
        })
      })
    })
  }
}