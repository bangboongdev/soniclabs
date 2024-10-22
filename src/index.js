import fs from "fs"
import App from './app.js'
import { PRIVATE_KEYS, PROXIES, SMART_ADDRESSES } from './config.js'
import log from './log.js'
import Output from './output.js'
import { toHumanTime, wait } from './utils.js'

async function play(app, game) {
  while (!app.limitedGames[game]) {
    const method = 'play' + game.charAt(0).toUpperCase() + game.slice(1)
    try {
      await app[method]()
      await app.getPoints()
    } catch (error) {
      await app.gameWait(game, 30000, error)
    }
  }
}

async function run(account, smartAddress, proxy) {
  const app = new App(account, smartAddress, proxy)
  try {
    log.info(account, `Đang khởi tạo tài khoản: ${PRIVATE_KEYS.indexOf(account) + 1} (${account})`)
    await app.connect()
    await app.getBalance()
    await app.connectToSonic()
    await app.getUser()
    await app.getPoints()
    await app.tryToUpdateReferrer()
    await app.createSession()
    await app.permitTypedMessage()

    await play(app, 'plinko')
    await play(app, 'mines')
    await play(app, 'singlewheel')

    // Schedule next cycle
    const duration = 2 * 3600 * 1000 // 2h
    log.info(account, `Chu kỳ hoàn tất cho tài khoản ${app.address}. pausing for ${toHumanTime(duration)}`)
    await wait(duration, `Chờ đến chu kỳ tiếp theo: ${toHumanTime(duration)}`, app)

    return run(account, smartAddress, proxy)
  } catch (error) {
    log.info(account, `Đã gặp lỗi. thử lại sau 60 giây.`)
    await wait(60000, `Lỗi: ${error.message || JSON.stringify(error)}. Thử lại sau 60 giây`, app)
    return run(account, smartAddress, proxy)
  }
}

async function startBot() {
  try {
    if (PROXIES.length !== PRIVATE_KEYS.length && PROXIES.length !== 0) {
      throw new Error(`số lượng proxy phải khớp với số lượng tài khoản hoặc để trống.`)
    }

    const tasks = PRIVATE_KEYS.map((account, index) => {
      run(account, SMART_ADDRESSES[index] || undefined, PROXIES[index] || undefined)
      log.info(account, `tài khoản đã bắt đầu: ${account}`)
    })

    await Promise.all(tasks)
  } catch (error) {
    console.error('Bot bị dừng do lỗi:', error)
  }
}

(async () => {
  try {
    fs.rmSync('logs/', { recursive: true })
    console.clear()

    await startBot()
  } catch (error) {
    Output.clearInfo()
    console.error('Đã gặp lỗi nghiêm trọng, đang khởi động lại...', error)
    await startBot() 
  }
})()
