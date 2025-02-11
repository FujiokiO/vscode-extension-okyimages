const assert = require('assert');
const vscode = require('vscode');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const extension = require('../extension');

suite('OKY Images Extension Test Suite', () => {
    let sandbox;
    let testFilePath;
    let testEditor;

    suiteSetup(async () => {
        // 创建测试用的markdown文件
        const workspacePath = path.join(__dirname, 'workspace');
        if (!fs.existsSync(workspacePath)) {
            fs.mkdirSync(workspacePath);
        }
        testFilePath = path.join(workspacePath, 'test.md');
        fs.writeFileSync(testFilePath, '# Test Document');

        // 打开测试文件
        const doc = await vscode.workspace.openTextDocument(testFilePath);
        testEditor = await vscode.window.showTextDocument(doc);
    });

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suiteTeardown(() => {
        // 清理测试文件
        if (fs.existsSync(testFilePath)) {
            fs.unlinkSync(testFilePath);
        }
    });

    test('Extension should be present', () => {
        assert.ok(vscode.extensions.getExtension('publisher.okyimages'));
    });

    test('Should activate on markdown files', async () => {
        const ext = vscode.extensions.getExtension('publisher.okyimages');
        await ext.activate();
        assert.strictEqual(ext.isActive, true);
    });

    test('Upload file function should work correctly', async () => {
        // 创建测试图片
        const testImagePath = path.join(__dirname, 'test.png');
        const testImageData = Buffer.from('fake image data');
        fs.writeFileSync(testImagePath, testImageData);

        // Mock axios post request
        const mockResponse = {
            status: 200,
            data: {
                imageUrl: 'test/image.png'
            }
        };
        sandbox.stub(axios, 'post').resolves(mockResponse);

        try {
            // 测试上传功能
            const command = await vscode.commands.executeCommand('okyimages.selectImage');
            
            // 验证是否调用了上传API
            assert(axios.post.calledOnce);
            
            // 验证编辑器中是否插入了正确的markdown
            const documentText = testEditor.document.getText();
            assert(documentText.includes('![](https://images.oky.ac.cn/.netlify/images?url=/api/upload/test/image.png)'));
        } finally {
            // 清理测试图片
            if (fs.existsSync(testImagePath)) {
                fs.unlinkSync(testImagePath);
            }
        }
    });

    test('Paste image command should handle clipboard images', async () => {
        // Mock clipboard
        const fakeImageData = Buffer.from('fake image data');
        sandbox.stub(vscode.env.clipboard, 'readImage').resolves({
            data: fakeImageData,
            width: 100,
            height: 100
        });

        // Mock axios response
        sandbox.stub(axios, 'post').resolves({
            status: 200,
            data: {
                imageUrl: 'pasted/image.png'
            }
        });

        // 执行粘贴命令
        await vscode.commands.executeCommand('okyimages.pasteImage');

        // 验证是否调用了剪贴板API
        assert(vscode.env.clipboard.readImage.calledOnce);
        
        // 验证是否调用了上传API
        assert(axios.post.calledOnce);

        // 验证编辑器中是否插入了正确的markdown
        const documentText = testEditor.document.getText();
        assert(documentText.includes('![](https://images.oky.ac.cn/.netlify/images?url=/api/upload/pasted/image.png)'));
    });

    test('Should handle upload errors gracefully', async () => {
        // Mock error response
        sandbox.stub(axios, 'post').rejects(new Error('Upload failed'));

        // Mock showErrorMessage
        const showErrorMessage = sandbox.stub(vscode.window, 'showErrorMessage');

        // 执行上传命令
        await vscode.commands.executeCommand('okyimages.selectImage');

        // 验证是否显示了错误消息
        assert(showErrorMessage.calledWith('图片上传失败: Upload failed'));
    });

    test('Should only activate in markdown files', async () => {
        // 创建一个非markdown文件
        const txtFilePath = path.join(__dirname, 'workspace', 'test.txt');
        fs.writeFileSync(txtFilePath, 'test content');

        try {
            // 打开非markdown文件
            const doc = await vscode.workspace.openTextDocument(txtFilePath);
            await vscode.window.showTextDocument(doc);

            // 尝试执行命令
            const result = await vscode.commands.executeCommand('okyimages.pasteImage');
            
            // 验证命令是否被阻止
            assert.strictEqual(result, undefined);
        } finally {
            // 清理测试文件
            if (fs.existsSync(txtFilePath)) {
                fs.unlinkSync(txtFilePath);
            }
        }
    });
});