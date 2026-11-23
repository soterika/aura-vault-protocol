require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("hardhat-gas-reporter");
require("solidity-coverage");

const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

const solcVersion = "0.8.20";

subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD).setAction(async ({ solcVersion: requested }, _hre, runSuper) => {
  if (requested !== solcVersion) {
    return runSuper();
  }

  return {
    compilerPath: require.resolve("solc/soljson.js"),
    isSolcJs: true,
    version: solcVersion,
    longVersion: require("solc").version(),
  };
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: solcVersion,
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  paths: {
    sources: "./strategy",
    tests: "./strategy",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  gasReporter: {
    enabled: true,
    currency: "USD",
    noColors: false,
  },
};
