import * as vscode from 'vscode';
import { BigQuery } from '@google-cloud/bigquery';
import { Resource } from '@google-cloud/resource';
import { BigQueryResourceProvider } from './bigqueryResources';
import { BigQueryFormatter } from './formatter';

const languageId = 'BigQuery';
let bqClient: BigQuery;
let resourceClient: Resource;

let projectItem: vscode.StatusBarItem;
let dryRunItem: vscode.StatusBarItem;

let dryRunTimer: NodeJS.Timer;

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(vscode.commands.registerCommand('extension.dryRun', () => dryRun()));
    context.subscriptions.push(vscode.commands.registerCommand('extension.setProjectCommand', () => setProjectCommand()));

    bqClient = new BigQuery();
    resourceClient = new Resource();

    projectItem = createProjectItem();
    dryRunItem = createDryRunItem();
    updateStatusBarItem();

    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(updateStatusBarItem));

    vscode.window.onDidChangeTextEditorSelection((_) => updateDryRunTimer());

    const bigQueryResourceProvider = new BigQueryResourceProvider(vscode.workspace.rootPath);
    vscode.window.createTreeView('bigQueryResources', {
        treeDataProvider: bigQueryResourceProvider
    })
    vscode.commands.registerCommand("bigQueryResources.refreshAllResources",
        () => bigQueryResourceProvider.refreshAllResources())

    vscode.languages.registerDocumentFormattingEditProvider("BigQuery", {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
            const formatter = new BigQueryFormatter();
            
            const unformatted = document.getText();
            const formatted = formatter.format(unformatted);

            const start = document.lineAt(0).range.start;
            const end = document.lineAt(document.lineCount - 1).range.end;
            const fullRange = new vscode.Range(start, end);

            return [
                vscode.TextEdit.delete(fullRange),
                vscode.TextEdit.insert(document.lineAt(0).range.start, formatted)
            ]
        }
    })

}

function createStatusBarItem(priority: number): vscode.StatusBarItem {
    const alignment = vscode.StatusBarAlignment.Right;
    return vscode.window.createStatusBarItem(alignment, priority);
}

function createProjectItem(): vscode.StatusBarItem {
    const item = createStatusBarItem(1);
    item.command = "extension.setProjectCommand";
    return item;
}

function createDryRunItem(): vscode.StatusBarItem {
    const item = createStatusBarItem(0);
    item.command = "extension.dryRun";
    return item;
}

function setProjectCommand(): void {
    let options: vscode.InputBoxOptions = {
        ignoreFocusOut: false,
    }

    resourceClient.getProjects()
        .then(p => p[0])
        .then(ps => ps.map(p => p.id))
        .then(ps => vscode.window.showQuickPick(ps))
        .then(p => {
            if (typeof (p) !== 'undefined') {
                bqClient.projectId = p;
                updateProjectIdItem();
            }
        })
        .catch(error => vscode.window.showErrorMessage(error.message));
}

function updateStatusBarItem(): void {
    if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId == languageId) {
        updateProjectIdItem();
        showStatusBarItems();
    } else {
        hideStatusBarItems();
    }
}

function updateProjectIdItem(): void {
    bqClient.getProjectId()
        .then(p => projectItem.text = p)
        .catch(error => vscode.window.showErrorMessage(error.message));
}

function showStatusBarItems(): void {
    projectItem.show();
    dryRunItem.show();
}

function hideStatusBarItems(): void {
    projectItem.hide();
    dryRunItem.hide();
}

function updateDryRunTimer(): void {
    clearTimeout(dryRunTimer);
    dryRunTimer = setTimeout(() => dryRun(), 500)
}

function dryRun(): void {
    updateStatusBarItem();
    const activeEditor = vscode.window.activeTextEditor;
    if (activate) {
        const query = activeEditor.document.getText()
        const queryOptions = {
            query: query,
            dryRun: true,
            location: bqClient.location
        }
        dryRunItem.text = "$(loading)";
        dryRunItem.tooltip = "Performing dry run..."

        bqClient.createQueryJob(queryOptions)
            .then(jobResponse => jobResponse[0])
            .then(job => job.metadata.statistics)
            .then(statistics => statistics.totalBytesProcessed)
            .then(bytes => formatProcessedBytes(bytes))
            .then(s => {
                dryRunItem.text = "$(pass) " + s;
                dryRunItem.tooltip = s;
            })
            .catch(error => {
                dryRunItem.text = "$(warning)";
                dryRunItem.tooltip = error.message;
            })
    }
}

function formatProcessedBytes(bytes: number): string {
    const capacities = ["B", "KB", "MB", "GB", "TB", "PB"];
    let n = +bytes;
    let capacityIndex = 0;
    for (let i = 0; i < capacities.length; i++) {
        capacityIndex = i;
        if (n < 1024) {
            break;
        } else {
            n /= 1024;
        }
    }

    return `${n.toPrecision(2)} ${capacities[capacityIndex]}`
}

export function deactivate(): void {
    projectItem.dispose();
}
