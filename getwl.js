import axios from 'axios';
import fs from 'fs/promises';
import { ethers } from 'ethers';

async function getSmartWalletAddress(ownerAddress, rpcUrl) {
  const payload = {
    jsonrpc: "2.0",
    id: 14,
    method: "eth_call",
    params: [
      {
        data: `0x5fbfb9cf000000000000000000000000${ownerAddress.slice(2)}0000000000000000000000000000000000000000000000000000000000000000`,
        to: "0x5a174Dd1272Ea03A41b24209ed2A3e9ee68f9148"
      },
      "latest"
    ]
  };

  try {
    const response = await axios.post(rpcUrl, payload, {
      headers: { 'Content-Type': 'application/json' }
    });

    if (response.data && response.data.result) {
      const smartWalletAddress = "0x" + response.data.result.slice(26);
      return smartWalletAddress.toLowerCase();
    } else {
      return null;
    }
  } catch (error) {
    console.error('Error:', error.message);
    return null;
  }
}

async function processPrivateKeys() {
  const rpcUrl = "https://rpc.testnet.soniclabs.com/";
  
  try {
    const privateKeys = await fs.readFile('privatekey.txt', 'utf-8');
    const privateKeyList = privateKeys.split('\n').filter(key => key.trim() !== '');

    let walletOutput = '';

    for (let i = 0; i < privateKeyList.length; i++) {
      const privateKey = privateKeyList[i].trim();
      const wallet = new ethers.Wallet(privateKey);
      const address = wallet.address;

      const smartWallet = await getSmartWalletAddress(address, rpcUrl);
      
      if (smartWallet) {
        walletOutput += `${smartWallet}\n`;
        console.log(`Đang xử lý ví ${i + 1}: ${address} -> ${smartWallet}`);
      } else {
        walletOutput += `Lỗi xử lý ví ${i + 1}: ${address}\n`;
        console.error(`Lỗi xử lý ví ${i + 1}: ${address}`);
      }
    }

    await fs.writeFile('wallet.txt', walletOutput);
    console.log('Địa chỉ ví thông minh đã được ghi vào wallet.txt');

  } catch (error) {
    console.error('Error:', error.message);
  }
}

processPrivateKeys();