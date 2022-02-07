from pyteal import *

succeed = Bytes("succeed")


def approval():
    is_app_creator = Txn.sender() == Global.creator_address()
    checker = Seq(Assert(Txn.application_args[0] == succeed), Int(1))
    return Cond(
        [Txn.application_id() == Int(0), Int(1)],
        [Txn.on_completion() == OnComplete.DeleteApplication, is_app_creator],
        [Txn.on_completion() == OnComplete.UpdateApplication, is_app_creator],
        [Txn.on_completion() == OnComplete.CloseOut, Int(0)],
        [Txn.on_completion() == OnComplete.OptIn, Int(0)],
        [Txn.on_completion() == OnComplete.NoOp, checker],
    )


def clear():
    return Approve()


def lsig():
    return Seq(Assert(Gtxn[1].application_args[0] == succeed), Int(1))


if __name__ == "__main__":
    import os

    path = os.path.dirname(os.path.abspath(__file__))

    with open(os.path.join(path, "approval.teal"), "w") as f:
        f.write(
            compileTeal(
                approval(), mode=Mode.Application, version=5, assembleConstants=True
            )
        )

    with open(os.path.join(path, "clear.teal"), "w") as f:
        f.write(
            compileTeal(
                clear(), mode=Mode.Application, version=5, assembleConstants=True
            )
        )

    with open(os.path.join(path, "sig.teal"), "w") as f:
        f.write(
            compileTeal(lsig(), mode=Mode.Signature, version=5, assembleConstants=True)
        )
