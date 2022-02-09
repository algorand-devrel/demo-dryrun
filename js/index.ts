import algosdk, { assignGroupID, decodeSignedTransaction, Kmd, LogicSigAccount, makeApplicationCallTxnFromObject, makeApplicationNoOpTxnFromObject, makePaymentTxnWithSuggestedParamsFromObject, signLogicSigTransaction, signTransaction } from "algosdk";
import { DryrunResponse } from "algosdk/dist/types/src/client/v2/algod/models/types";
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
  const dres = new DryrunResult(drr_result)
  for(const t of dres.txns){
    console.log(t.appTrace());
  }
})();




class DryrunResult {
  error: string = "";
  protocolVersion: string = "";
  txns: DryrunTransactionResult[] = [];
  constructor(drr_resp: Record<string, any>) {
    this.error = drr_resp['error']
    this.protocolVersion = drr_resp['protocol-version']
    this.txns = drr_resp['txns'].map((txn: any)=>{
      return new DryrunTransactionResult(txn)
    })
  }
}

function convertKey(str: string): string {
  return str.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
}

class DryrunTransactionResult {
  default_spaces: number = 50;

  disassembly: string[] = [];
  appCallMessages: string[] | undefined = [];
  localDeltas: any[] | undefined = [];
  globalDelta: any[] | undefined  = [];
  cost: number | undefined = 0;
  logicSigMessages: string[] | undefined = [];
  logicSigDisassemly: string[] | undefined = [];
  logs: string[] | undefined = [];

  appCallTrace: DryrunTrace | undefined = undefined;
  logicSigTrace: DryrunTrace | undefined = undefined;

  required = ["disassembly"]
  optionals = [
      "app-call-messages",
      "local-deltas",
      "global-delta",
      "cost",
      "logic-sig-messages",
      "logic-sig-disassembly",
      "logs",
  ]
  traces = ["app-call-trace", "logic-sig-trace"]

  constructor(dtr: Record<string, any>) {
    this.disassembly = dtr['disassembly']
    this.appCallMessages = dtr["app-call-messages"]
    this.localDeltas = dtr["local-deltas"]
    this.globalDelta = dtr["global-delta"]
    this.cost = dtr["cost"]
    this.logicSigMessages = dtr['logic-sig-messages'];
    this.logicSigDisassemly = dtr['logic-sig-messages'];
    this.logs = dtr['logs']
    this.appCallTrace = new DryrunTrace(dtr['app-call-trace'])
    this.logicSigTrace = new DryrunTrace(dtr['logic-sig-trace'])
  }

  trace(drt: DryrunTrace, disassembly: string[], spaces?: number): string {
    if(spaces == undefined) spaces = this.default_spaces;

    const lines = ["pc# line# source" + " ".repeat(spaces - 16) + "stack"]
    for(const [line, pc, stack] of drt.getTrace()) {
        const line_padding = " ".repeat(4-line.toString().length)
        const pc_padding = " ".repeat(4-pc.toString().length)
        const dis = disassembly[line]

        const src_line = `${pc_padding}${pc} ${line_padding}${line} ${dis}`

        const stack_padding = " ".repeat(Math.max(1, spaces - src_line.length))

        lines.push(`${src_line}${stack_padding}${stack}`)
    }

    return lines.join("\n")
  }


  appTrace(): string {
    if(this.appCallTrace === undefined || !this.disassembly) return ""
    return this.trace(this.appCallTrace, this.disassembly)
  }

  lsigTrace(): string {
    if(this.logicSigTrace === undefined || this.logicSigDisassemly===undefined) return ""
    return this.trace(this.logicSigTrace, this.logicSigDisassemly)
  }
}

class DryrunTrace {
  trace: DryrunTraceLine[] = [];

  constructor(t: Record<string, any>[]){
    if(t === undefined) return;
    this.trace = t.map((line)=>{
      return new DryrunTraceLine(line)
    })
  }

  getTrace(): any[] {
    return this.trace.map((dtl)=>{ return dtl.traceLine() })
  }
}

class DryrunTraceLine {
  line: number = 0;
  pc: number = 0;
  stack: DryrunStackValue[] = [];

  constructor(line: Record<string, any>){
    this.line = line['line']
    this.pc = line['pc']
    this.stack = line['stack'].map((sv: Record<string, any>)=>{
      return new DryrunStackValue(sv)
    })
  }

  traceLine(): [number, number, string] {
    return [
      this.line,
      this.pc,
      "["+this.stack.map((sv)=>{
        return sv.toString()
      }).join(",")+"]"
    ]
  }
}

class DryrunStackValue {
  type: number = 0;
  bytes: string = "";
  uint: number = 0;

  constructor(sv: Record<string, any>) {
    this.type = sv['type']
    this.bytes = sv['bytes']
    this.uint = sv['uint']
  }

  toString(): string {
    if(this.type === 1){
      return this.bytes
    }
    return this.uint.toString()
  }
}




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
  console.log(signed)
  fs.writeFileSync("tmp.txn", signed)

  const {txId} = await client
    .sendRawTransaction([signed])
    .do();


  const result = await client.pendingTransactionInformation(txId).do();

  // Doesnt work in dev-mode 
  // const result = await algosdk.waitForConfirmation(client, txid, 3);

  return result["application-index"];
}

