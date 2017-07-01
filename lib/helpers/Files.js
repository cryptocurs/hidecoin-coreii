'use strict'

const fs = require('fs')

const Asyncs = require('./Asyncs')

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
  
  removeDir(path) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(path)) {
        resolve()
        return
      }
      
      fs.readdir(path, (err, files) => {
        if (err) {
          throw err
        }
        Asyncs.forEach(files, (file, i, next) => {
          fs.unlink(path + file, (err) => {
            if (err) {
              throw err
            }
            next()
          })
        }, () => {
          fs.rmdir(path, (err) => {
            if (err) {
              throw err
            }
            resolve()
          })
        })
      })
    })
  }
  
  copy(src, dst) {
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
  
  copyBack(dst, src) {
    return this.copy(src, dst)
  }
  
  touch(path) {
    return new Promise((resolve, reject) => {
      fs.writeFile(path, Buffer.from([]), (err) => {
        if (err) {
          throw err
        }
        resolve(true)
      })
    })
  }
}