import { ethers } from 'ethers'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { CONTRACT as CONTRACT_ADDRESS, GAMES, PRIVATE_KEYS, REFERRER_CODE, RPC } from './config.js'
import log from './log.js'
import { getPrivateKeyType, getRandomUserAgent, toHumanTime, wait } from './utils.js'
import csvdb from "csv-database";

export default class App {
  constructor(privateKey, address, proxy) {
    this.baseUrl = 'https://arcade.soniclabs.com'
    this.host = 'arcade.soniclabs.com'
    this.origin = 'https://arcade.soniclabs.com'
    this.userAgent = getRandomUserAgent()
    this.proxy = proxy
    this.sessionId = 1
    this.wallet = null
    this.today_points = null
    this.total_points = null
    this.privateKey = privateKey;
    this.address = null
    this.address = address
    this.permitSignature = null
    this.referrerCode = REFERRER_CODE
    this.limitedGames = {
      plinko: false,
      singlewheel: false,
      mines: false,
    }
    this.gameStatus = {
      plinko: { message: 'pending', waiting: '-' },
      singlewheel: { message: 'pending', waiting: '-' },
      mines: { message: 'pending', waiting: '-' },
    }

    try {
      this.provider = new ethers.JsonRpcProvider(RPC.RPCURL, RPC.CHAINID)
    } catch (error) {
      log.error(this.address, `Không thể kết nối với testnet: ${error}`)
    }
  }

  async gameWait(game, milliseconds, message) {
    this.gameStatus[game].message = message
    this.gameStatus[game].waiting = toHumanTime(milliseconds)

    await wait(milliseconds, message, this)
  }

  async connect() {
    try {
      const cleanPrivateKey = this.privateKey.replace(/^0x/, '');
      this.wallet = new ethers.Wallet(cleanPrivateKey, this.provider);
      if(!this.address){
        await db.edit({privateKey: this.privateKey}, {address: this.wallet.address});
      }
      this.address = this.wallet.address
      await wait(4000, 'Wallet address: ' + JSON.stringify(this.address), this)
    } catch (error) {
      throw error
    }
  }

  async createSession() {
    await wait(4000, 'Creating session', this)
    const response = await this.fetch('https://sonic-hub1.joinrebellion.com/rpc', 'POST', {
      jsonrpc: '2.0',
      id: this.sessionId,
      method: 'createSession',
      params: {
        owner: this.wallet.address,
        until: Date.now() + 86400000 // 24 hours in milliseconds
      }
    }, { network: 'SONIC', pragma: 'no-cache', 'x-owner': this.address }, 'https://arcade.soniclabs.com/', true)

    this.sessionId += 1
    if (response.status === 200) {
      await wait(1000, 'Successfully create session', this)
    } else {
      throw Error('Failed to create session')
    }
  }

  async getBalance(refresh = false) {
    try {
      if (!refresh) {
        await wait(500, 'Đọc balance: ' + this.wallet.address, this)
      }
      this.balance = ethers.formatEther(await this.provider.getBalance(this.wallet.address))
      await wait(500, 'Balance updated: ' + this.balance, this)
    } catch (error) {
      log.error(this.address, `Failed to get balance: ${error}`)
      throw error
    }
  }

  async getUser() {
    await wait(4000, 'Đang đọc thông tin người dùng', this)
    const response = await this.fetch(`https://airdrop.soniclabs.com/api/trpc/user.findOrCreate?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: { json: { address: this.wallet.address } } }))}`, 'GET')
    if (response.status == 200) {
      this.user = response[0].result.data.json
      await wait(500, 'Thông tin người dùng được đọc thành công', this)
    } else {
      throw new Error('Không lấy được thông tin người dùng')
    }
  }

  async getPoints() {
    if (!this.address) {
      await wait(500, 'Địa chỉ thông minh chưa được cấu hình, bỏ qua', this)
      return
    }
    await wait(4000, "Kiểm tra points đang có", this)
    try {
      const response = await this.fetch(`https://arcade.gateway.soniclabs.com/game/points-by-player?wallet=${this.address}`, 'GET', undefined, undefined, 'https://arcade.soniclabs.com/', true)
  
      if (response.status == 200) {
        this.today_points = response.today
        this.total_points = response.totalPoints
        await wait(1500, "Đã lấy được points", this)
      } else {
        throw new Error("Failed to get points")
      }
    } catch (error) {
      log.error(this.address, `Error getting points: ${error.message}`)
      // Skip the error and continue execution
    }
  }

  async register() {
    try {
      wait(15000, 'Registering user key')
      const abi = new ethers.Interface([{
        'inputs': [{
          'internalType': "address",
          'name': 'spender',
          'type': "address"
        }, {
          'internalType': "uint256",
          'name': 'amount',
          'type': "uint256"
        }],
        'name': 'approve',
        'outputs': [{
          'internalType': "bool",
          'name': '',
          'type': "bool"
        }],
        'stateMutability': "nonpayable",
        'type': 'function'
      }])
      const data = abi.encodeFunctionData("approve", [this.address, ethers.MaxUint256])
      const response = await this.fetch("https://sonic-hub1.joinrebellion.com/rpc", "POST", {
        'jsonrpc': "2.0",
        'id': 0x7,
        'method': "call",
        'params': {
          'call': {
            'dest': '0x4Cc7b0ddCD0597496E57C5325cf4c73dBA30cdc9',
            'data': data,
            'value': '0n'
          },
          'owner': this.address,
          'part': this.part,
          'permit': this.permitSignature
        }
      }, {
        'network': "SONIC",
        'pragma': "no-cache",
        'priority': "u=1, i",
        'x-owner': this.address
      }, "https://arcade.soniclabs.com/", true)
      this.sessionId += 1
      if (response.status == 200) {
        await wait(1500, "User key registered", this)
        await this.getPoints()
      } else {
        await wait(4000, "Failed to register user key", this)
        await this.register()
      }
    } catch (error) {
      await this.register()
    }
  }

  async refund(game) {
    await wait(1500, `Refunding game ${game} to resolve awaiting random number`, this)
    const response = await this.fetch('https://sonic-hub1.joinrebellion.com/rpc', "POST", {
      'jsonrpc': "2.0",
      'id': this.sessionId,
      'method': "refund",
      'params': {
        'game': game,
        'player': this.address
      }
    }, {
      'network': "SONIC",
      'x-owner': this.address
    }, "https://arcade.soniclabs.com/", true)
    this.sessionId += 0x1
    if (response.status == 0xc8) {
      await wait(1500, `Successfully refund game: ${game}`, this)
    } else {
      throw Error("Failed to Refund Game")
    }
  }

  async reIterate(game) {
    await wait(1500, `Reiterate game ${game} to resolve awaiting random number`, this)
    const response = await this.fetch("https://sonic-hub1.joinrebellion.com/rpc", "POST", {
      'jsonrpc': '2.0',
      'id': this.sessionId,
      'method': "reIterate",
      'params': {
        'game': game,
        'player': this.address
      }
    }, {
      'network': "SONIC",
      'x-owner': this.address
    }, "https://arcade.soniclabs.com/", true)
    this.sessionId += 0x1
    if (response.status == 0xc8) {
      await wait(1500, `Successfully reiterate game: ${game}`, this)
    } else {
      throw Error(`Failed to reiterate game ${game}`)
    }
  }

  async connectToSonic() {
    await wait(4000, 'Đang kết nối với Sonic Arcade', this)

    const messageToSign = "I'm joining Sonic Airdrop Dashboard with my wallet, have been referred by " + this.referrerCode + ", and I agree to the terms and conditions.\nWallet address:\n" + this.address + "\n"
    log.info(this.address, 'Message to sign: ' + messageToSign)

    this.signatureMessage = await this.wallet.signMessage(messageToSign)
    log.info(this.address, 'signature: ' + this.signatureMessage)

    await wait(4000, 'Đã kết nối thành công với Sonic Dapp', this)
  }

  async tryToUpdateReferrer() {
    try {
      await wait(4000, 'Xác thực mã mời', this)

      if (this.user.invitedCode == null) {
        const response = await this.fetch('/api/trpc/user.setInvited?batch=1', 'POST', {
          json: { address: this.wallet.address, invitedCode: this.invitedCode, signature: this.signatureMessage }
        })

        if (response.status == 200) {
          await wait(4000, 'Đã cập nhật thành công mã mời', this)
          await this.getUser()
        }
      } else {
        await wait(4000, 'Mã mời đã được đặt', this)
      }
    } catch (error) {
      log.error(this.address, `Không cập nhật được mã mời người dùng: ${error}`)
    }
  }

  async permitTypedMessage() {
    await wait(4000, 'Cho phép hợp đồng Sonic Arcade', this)
    const response = await this.fetch('https://sonic-hub1.joinrebellion.com/rpc', 'POST', {
      'id': this.sessionId,
      'jsonrpc': '2.0',
      'method': 'permitTypedMessage',
      'params': {
        'owner': this.address
      }
    }, {
      'network': 'SONIC',
      'pragma': 'no-cache',
      'priority': 'u=1, i',
      'x-owner': this.address
    }, 'https://arcade.soniclabs.com/', true)
    this.sessionId += 1

    if (response.status == 200) {
      const message = JSON.parse(response.result.typedMessage)
      await wait(500, 'Tạo giấy phép thành công', this)
      await wait(500, 'Thông báo phê duyệt giấy phép', this)
      this.permitSignature = await this.wallet.signTypedData(message.json.domain, message.json.types, message.json.message)
      await this.permit()
    } else {
      throw Error('Không thể tạo phiên Sonic Arcade')
    }
  }

  async performRpcRequest(method, params, headers, referer) {
    return this.fetch('https://sonic-hub1.joinrebellion.com/rpc', 'POST', {
      jsonrpc: '2.0',
      id: this.sessionId,
      method: method,
      params: params
    }, headers || { network: 'SONIC', pragma: 'no-cache', 'priority': 'u=1, i', 'x-owner': this.address }, 'https://arcade.soniclabs.com/')
  }

  async permit() {
    await wait(4000, 'Nộp giấy phép hợp đồng', this)

    const response = await this.performRpcRequest('permit', {
      owner: this.address,
      signature: this.permitSignature
    })

    this.sessionId += 1

    if (!response.error) {
      this.part = response.result.hashKey
      await wait(4000, 'Đã gửi giấy phép thành công', this)
    } else {
      throw new Error(`Không nộp được giấy phép: ${response.error.message}`)
    }
  }

  async playPlinko() {
    await this.playGame('plinko')

    // todo: get random int 1-0, then foreach call:
    // fetch("https://rpc.testnet.soniclabs.com/", {
    //   "headers": {
    //     "accept": "*/*",
    //     "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
    //     "cache-control": "no-cache",
    //     "content-type": "application/json",
    //     "pragma": "no-cache",
    //     "priority": "u=1, i",
    //     "sec-ch-ua": "\"Google Chrome\";v=\"129\", \"Not=A?Brand\";v=\"8\", \"Chromium\";v=\"129\"",
    //     "sec-ch-ua-mobile": "?0",
    //     "sec-ch-ua-platform": "\"macOS\"",
    //     "sec-fetch-dest": "empty",
    //     "sec-fetch-mode": "cors",
    //     "sec-fetch-site": "same-site"
    //   },
    //   "referrer": "https://arcade.soniclabs.com/",
    //   "referrerPolicy": "strict-origin-when-cross-origin",
    //   "body": "{\"jsonrpc\":\"2.0\",\"id\":98,\"method\":\"eth_call\",\"params\":[{\"data\":\"0x5a57d9ed00000000000000000000000034cc34566ff6b3f8b966e45b40fa9a6d686426ee0000000000000000000000001cc5bc5c6d5fbb637164c8924528fb2d611fa509\",\"to\":\"0x97b4EADc96ab6eA7c2Afe3B0A831F835A850BA53\"},\"latest\"]}",
    //   "method": "POST",
    //   "mode": "cors",
    //   "credentials": "omit"
    // });
  }

  async playSinglewheel() {
    await this.playGame('singlewheel')
  }

  async claimMinesGame() {
    await this.gameWait('mines', 4000, "Claiming previous mines game", this)
    
    const response = await this.fetch('https://sonic-hub1.joinrebellion.com/rpc', 'POST', {
      'jsonrpc': "2.0",
      'id': this.sessionId,
      'method': "call",
      'params': {
        'call': {
          'dest': CONTRACT_ADDRESS,
          'data': "0x0d942fd00000000000000000000000008bbd8f37a3349d83c85de1f2e32b3fd2fce2468e0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000e328a0b1e0be7043c9141c2073e408d1086e117500000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000e00000000000000000000000000000000000000000000000000000000000000007656e6447616d65000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
          'value': '0n'
        },
        'owner': this.address,
        'part': this.part,
        'permit': this.permitSignature
      }
    }, {
      'network': "SONIC",
      'pragma': "no-cache",
      'priority': "u=1, i",
      'x-owner': this.address
    }, 'https://arcade.soniclabs.com/', true)

    if (response.error) {
      await this.gameWait('mines', 2000, `Claim attempt result: ${response.error?.message}`, this)
      return false
    }

    if (response.result?.hash?.errorTypes) {
      await this.gameWait('mines', 2000, `Claim attempt result: ${response.result?.hash?.actualError?.details}`, this)
      return false
    }

    await this.gameWait('mines', 2000, "Successfully claimed previous mines game", this)
    return true
  }

  async playMines() {
    if (this.limitedGames['mines']) {
      return
    }

    try {
      await this.playGame('mines')
    } catch (error) {
      if (error.message.includes('Call revert')) {
        // Try to claim previous game first
        await this.claimMinesGame()
        // Wait a bit before retrying
        await this.gameWait('mines', 4000, "Retrying mines game after claim attempt", this)
        // Retry playing the game
        await this.playGame('mines')
      } else {
        throw error
      }
    }

    // After successful play, claim the rewards
    await this.gameWait('mines', 4000, "Processing mines game reward", this)
    await this.claimMinesGame()
  }

  async playGame(name) {
    if (!Object.prototype.hasOwnProperty.call(GAMES, name)) {
      throw new Error(`Undefined game: [${name}]`)
    }

    const callData = GAMES[name]

    await this.gameWait(name, 4000, `Playing game: [${name}]`, this)

    const response = await this.performRpcRequest('call', {
      call: callData,
      owner: this.address,
      part: this.part,
      permit: this.permitSignature
    })

    this.sessionId += 1

    if (!response.error) {
      await this.gameWait(name, 4000, `Successfully played game: [${name}]`, this)
    } else {
      const errorMessage = response.error?.message || 'Unknown'

      if (errorMessage.includes('limit')) {
        this.limitedGames[name] = true
        return await this.gameWait(name, 4000, errorMessage, this)
      }

      if (errorMessage.includes('random number')) {
        await this.gameWait(name, 20000, errorMessage, this)
        return await this.reIterate(name)
      }

      if (errorMessage.includes('Permit')) {
        throw new Error(`Failed to play game: [${name}]: ${errorMessage}`)
      }

      if (response.result?.hash?.errorTypes) {
        await this.gameWait(name, 1500, `Play game failed: ${response.result?.hash?.actualError?.details}`, this)
        return
      }

      throw new Error(`Failed to play game: [${name}], error: ${errorMessage}`)
    }
  }

  async fetch(url, method, body = {}, customHeaders = {}, referer) {
    log.info(this.address, `Fetching: ${url}`)
    const requestUrl = url.startsWith('http') ? url : `${this.baseUrl}${url}`
    const headers = {
      ...customHeaders, ...{
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9,id;q=0.8',
        'Content-Type': 'application/json',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-Mode': 'cors',
        'Host': this.host,
        'Origin': this.origin,
        'Pragma': 'no-cache',
        'Referer': this.origin,
        'User-Agent': this.userAgent,
      }
    }

    const options = { method, headers, referer }

    try {
      log.info(this.address, `${method} Request URL: ${requestUrl}`)
      log.info(this.address, `Request headers: ${JSON.stringify(headers)}`)

      if (method !== 'GET') {
        options.body = JSON.stringify(body)
        log.info(this.address, `Request body: ${options.body}`)
      }

      options.agent =this.proxy ?  new HttpsProxyAgent(this.proxy, { rejectUnauthorized: false }) : null;
      

      const response = await fetch(requestUrl, options)

      log.info(this.address, `Response status: ${response.status} ${response.statusText}`)

      const contentType = response.headers.get('content-type')
      let responseData = contentType && contentType.includes('application/json')
        ? await response.json()
        : { status: response.status, message: await response.text() }

      log.info(this.address, `Response data: ${JSON.stringify(responseData)}`)

      if (response.ok) {
        responseData.status = 200 // Normalize status to 200 for successful responses
        return responseData
      } else {
        throw new Error(`${response.status} - ${response.statusText}`)
      }
    } catch (error) {
      if (requestUrl.includes('something') && error.message.includes('401')) {
        return { status: 200 }
      } else {
        log.error(this.address, `Error: ${error.message}`)
        throw error
      }
    }
  }

  async runTask() {
    try {
      await this.connect()
      log.info(this.address,`Đang khởi tạo tài khoản: `)
      await this.getBalance()
      await this.connectToSonic()
      await this.getUser()
      await this.getPoints()
      await this.tryToUpdateReferrer()
      await this.createSession()
      await this.permitTypedMessage()
  
      await play(this, 'plinko')
      await play(this, 'mines')
      await play(this, 'singlewheel')
  
      // Schedule next cycle
      const duration = 2 * 3600 * 1000 // 2h
      log.info(this.address,`Chu kỳ hoàn tất cho tài khoản ${this.address}. pausing for ${toHumanTime(duration)}`)
      await wait(duration, `Chờ đến chu kỳ tiếp theo: ${toHumanTime(duration)}`, this)
  
      return this.runTask()
    } catch (error) {
      log.info(this.address,`Đã gặp lỗi. thử lại sau 60 giây.`)
      await wait(60000, `Lỗi: ${error.message || JSON.stringify(error)}. Thử lại sau 60 giây`, this)
      return this.runTask()
    }
  }
}

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

const db = await csvdb(
  "sonic.csv",
  ["id", "active","privateKey","address","proxy_url"],
  ","
);
async function runBot(record) {
  const { active, privateKey, id, proxy_url, address } = record;
  
  const app = new App(privateKey, address,proxy_url);
  if(active == 1){
    await app.runTask();
  }
}

async function bot(action) {
  const records = await db.get();
  // for (let index = 0; index < records.length; index++) {
  //   const element = array[index];
  //   await runBot(element)
  // }
  Promise.all(records.map((record) => runBot(record)))
    .then(() => {
      console.log("All operations completed");
    })
    .catch((error) => {
      console.log("An error occurred during operation: ", error);
    });
}

async function main() {
  await bot();
}
main();