"""Python CLI for the same TypeScript AgentKernel; never reimplements policy.
No paid calls unless --live is explicitly passed. The SQLite ledger is shared.
"""
import argparse
import pathlib
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--live', action='store_true')
parser.add_argument('--model', choices=['gpt-4.1-mini', 'gpt-5.4'], default='gpt-4.1-mini')
parser.add_argument('--report', help='New report filename stem; preserve an existing baseline')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
command = ['npx', 'tsx', 'server/gauntlet/run.ts']
if args.live:
    command += ['--live', '--model', args.model]
if args.report:
    command += ['--report', args.report]
raise SystemExit(subprocess.call(command, cwd=root))
