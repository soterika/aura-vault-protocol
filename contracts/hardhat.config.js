import hardhatEthersChaiMatchers from "@nomicfoundation/hardhat-ethers-chai-matchers";
import hardhatMocha from "@nomicfoundation/hardhat-mocha";
import { defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatEthersChaiMatchers, hardhatMocha],
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "shanghai",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources: "./strategy",
    tests: { mocha: "./strategy" },
    cache: "./cache",
    artifacts: "./artifacts",
  },
});
