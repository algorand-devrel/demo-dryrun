from algosdk.transaction import assign_group_id
from algosdk.v2client import algod
from algosdk.future.transaction import *
from algosdk.dryrun_results import DryrunResponse
from base64 import b64decode
import os
import sys

from sandbox import get_accounts

path = os.path.dirname(os.path.abspath(__file__))

client = algod.AlgodClient("a" * 64, "http://localhost:4001")

arg = "succeed"
if len(sys.argv) > 1:
    arg = sys.argv[1]


def do_dryrun():
    accts = get_accounts()
    addr, pk = accts[0]

    app_id, app_addr = deploy_app(addr, pk)
    print("Created application {} with address: {}".format(app_id, app_addr))

    lsa, sig_addr = get_lsig()
    print("Created Signature with address: {}".format(sig_addr))

    # Get params for txns
    sp = client.suggested_params()

    # create trnansactions we wish to test
    pay_txn = PaymentTxn(addr, sp, sig_addr, 10000)
    app_txn = ApplicationCallTxn( sig_addr, sp, app_id, OnComplete.NoOpOC, app_args=[arg])

    # set group id
    assign_group_id([pay_txn, app_txn])

    # sign 'em
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


def deploy_app(addr, pk):
    with open(os.path.join(path, "../approval.teal"), "r") as f:
        approval_src = f.read().strip()

    res = client.compile(approval_src)
    approval = b64decode(res["result"])

    with open(os.path.join(path, "../clear.teal"), "r") as f:
        clear_src = f.read().strip()

    res = client.compile(clear_src)
    clear = b64decode(res["result"])

    sp = client.suggested_params()

    no_schema = StateSchema(0, 0)
    create = ApplicationCreateTxn(
        addr, sp, OnComplete.NoOpOC, approval, clear, no_schema, no_schema
    )
    signed = create.sign(pk)

    txid = client.send_transaction(signed)

    res = wait_for_confirmation(client, txid, 3)

    app_id = res["application-index"]
    app_addr = logic.get_application_address(app_id)
    return app_id, app_addr


def get_lsig():
    with open(os.path.join(path, "../sig.teal"), "r") as f:
        program = f.read().strip()

    res = client.compile(program)
    lsa = LogicSigAccount(b64decode(res["result"]))
    sig_addr = lsa.address()

    return lsa, sig_addr


if __name__ == "__main__":
    do_dryrun()
