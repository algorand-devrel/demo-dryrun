import algosdk, { 
  assignGroupID, decodeSignedTransaction, 
  LogicSigAccount, makeApplicationNoOpTxnFromObject, makePaymentTxnWithSuggestedParamsFromObject, 
  signLogicSigTransaction, signTransaction 
} from "algosdk";
import * as fs from "fs";
import { getAccounts } from "./sandbox";

const client = new algosdk.Algodv2("a".repeat(64), "http://127.0.0.1", "4001");

(async function () {
  const accts = await getAccounts();
  const acct = accts[0];

  const appId = await deployApp(acct);

  const lsig = await getLogicSig();

  const sp = await client.getTransactionParams().do()

  const payTxn = makePaymentTxnWithSuggestedParamsFromObject({
    from: acct.addr,
    to: lsig.address(),
    amount: 1000,
    suggestedParams: sp,
  })

  const appCallTxn = makeApplicationNoOpTxnFromObject({
    from: lsig.address(),
    appIndex: appId,
    appArgs: [new Uint8Array(Buffer.from("success"))],
    suggestedParams: sp,
  }) 

  const group = [payTxn, appCallTxn]

  assignGroupID(group)

  const signed = [
    signTransaction(payTxn, acct.sk), 
    signLogicSigTransaction(appCallTxn, lsig)
  ].map((txn)=>{
    return decodeSignedTransaction(txn.blob)
  })


  const drr = await algosdk.createDryrun({
    client: client,
    txns: signed,
  })


  const drr_result = await client.dryrun(drr).do()
  const parsed = new algosdk.DryrunResult(drr_result)

  for(const t of parsed.txns){
    console.log(t.appTrace());
  }
})();


async function getLogicSig(): Promise<algosdk.LogicSigAccount> {
  const sig = fs.readFileSync("../sig.teal");
  const res = await client.compile(sig).do();
  return new LogicSigAccount(Buffer.from(res["result"], "base64"));
}

async function deployApp(acct: algosdk.Account): Promise<number> {
  const appSrc = fs.readFileSync("../approval.teal");
  const appResult = await client.compile(appSrc).do();
  const appCompiled = new Uint8Array(
    Buffer.from(appResult["result"], "base64")
  );

  const clearSrc = fs.readFileSync("../clear.teal");
  const clearResult = await client.compile(clearSrc).do();
  const clearCompiled = new Uint8Array(
    Buffer.from(clearResult["result"], "base64")
  );

  const sp = await client.getTransactionParams().do();

  const create_txn = new algosdk.Transaction({
    from: acct.addr,
    appIndex: 0,
    type:algosdk.TransactionType.appl,
    appOnComplete: algosdk.OnApplicationComplete.NoOpOC,
    appClearProgram: clearCompiled,
    appApprovalProgram: appCompiled,
    ...sp,
  });

  const signed = create_txn.signTxn(acct.sk)
  const {txId} = await client
    .sendRawTransaction([signed])
    .do();

  const result = await client.pendingTransactionInformation(txId).do();

  // Doesnt work in dev-mode 
  // const result = await algosdk.waitForConfirmation(client, txid, 3);

  return result["application-index"];
}

