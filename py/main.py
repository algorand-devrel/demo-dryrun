from algosdk.transaction import assign_group_id
from algosdk.v2client import algod
from algosdk.future.transaction import *
from algosdk.dryrun_results import DryrunResponse
from base64 import b64decode
import os
import sys

from sandbox import get_accounts

path = os.path.dirname(os.path.abspath(__file__))

client = algod.AlgodClient("a"*64, "http://127.0.0.1:4001")

def do_dryrun():
    accts = get_accounts()

    (addr, pk) = accts[1]

    app_id = deploy_app(addr, pk)
    app_addr = logic.get_application_address(app_id)
    print("Created application {} with address: {}".format(app_id, app_addr))

    lsa = get_lsig()
    sig_addr = lsa.address()

    print("Created logic sig with address: {}".format(sig_addr))

    sp = client.suggested_params()

    arg = "succeed"
    if len(sys.argv)>1:
        arg = sys.argv[1]

    pay_txn = PaymentTxn(addr, sp, lsa.address(), 10000)
    app_txn = ApplicationCallTxn(lsa.address(), sp, app_id, OnComplete.NoOpOC, app_args=[arg])

    assign_group_id([pay_txn, app_txn])

    spay_txn = pay_txn.sign(pk)

    sapp_txn = LogicSigTransaction(app_txn, lsa)

    # Create the dryrun request object from the transactions
    drr = create_dryrun(client, [spay_txn, sapp_txn])

    resp = DryrunResponse(client.dryrun(drr))
    for txn in resp.txns:
        if txn.app_call_rejected():
            print("\nApp Mesages\n{}".format(txn.app_call_messages))
            print("\nApp Trace:\n{}".format(txn.app_trace(0)))
        if txn.logic_sig_rejected():
            print("\nLsig Mesages\n{}".format(txn.logic_sig_messages))
            print("\nLsig Trace\n{}".format(txn.lsig_trace(0)))

def deploy_app(addr, pk) -> int:
    with open(os.path.join(path, "../approval.teal"), "r") as f:
        approval_src = f.read().strip()

    res = client.compile(approval_src) 
    approval = b64decode(res['result'])

    with open(os.path.join(path, "../clear.teal"), "r") as f:
        clear_src = f.read().strip()

    res = client.compile(clear_src) 
    clear = b64decode(res['result'])

    sp = client.suggested_params()

    no_schema = StateSchema(0,0)
    create = ApplicationCreateTxn(addr, sp, OnComplete.NoOpOC, approval, clear, no_schema, no_schema)
    signed = create.sign(pk)

    txid = client.send_transaction(signed)

    res = wait_for_confirmation(client, txid, 3)

    return res['application-index']


def get_lsig() -> LogicSigAccount:
    with open(os.path.join(path, "../sig.teal"), "r") as f:
        program = f.read().strip()

    res = client.compile(program)
    return LogicSigAccount(b64decode(res['result']))



if __name__ == "__main__":
    do_dryrun()
