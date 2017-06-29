'use strict'

const blessed = require('blessed')

module.exports = (screen) => ({
  header: blessed.box({
    parent: screen,
    top: 0,
    left: 0,
    right: 0,
    bottom: screen.height - 1,
    content: '',
    tags: true,
    style: {
      fg: 'white',
      bg: 'cyan',
    }
  }),
  console: blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    bottom: 1,
    tags: true,
    style: {
      fg: 'white',
      bg: 'black',
    }
  }),
  consoleFixed: blessed.box({
    parent: screen,
    top: screen.height - 1,
    left: 0,
    right: 0,
    bottom: 1,
    tags: true,
    style: {
      fg: 'white',
      bg: 'cyan',
      bold: true
    }
  }),
  blocks: blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    bottom: 1,
    content: '{center}{bold}Block Explorer{/bold}{/center}',
    tags: true,
    style: {
      fg: 'white',
      bg: 'black'
    }
  }),
  miner: blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    bottom: 1,
    tags: true,
    style: {
      fg: 'white',
      bg: 'black'
    }
  }),
  wallet: blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    bottom: 1,
    tags: true,
    style: {
      fg: 'white',
      bg: 'black'
    }
  }),
  collision: blessed.box({
    parent: screen,
    top: 1,
    left: 0,
    right: 0,
    bottom: 1,
    tags: true,
    style: {
      fg: 'white',
      bg: 'black'
    }
  }),
  footer: blessed.box({
    parent: screen,
    top: screen.height - 1,
    left: 0,
    right: 0,
    bottom: 0,
    content: 'F1 Cnsl F2 Blks F3 Minr F4 Wlt  F5 Coll F6 Head {bold}F7 Use wallet{/bold}           F10 Quit',
    tags: true,
    style: {
      fg: 'white',
      bg: 'blue',
    }
  })
})