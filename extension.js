const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const crypto = require('crypto');
const { spawn } = require('child_process');

const POST_URL = 'https://images.oky.ac.cn/api/upload';
const GET_URL = 'https://images.oky.ac.cn/.netlify/images?url=';

// 使用 sharp 归一化图片（去除不同来源可能带来的元数据差异），确保相同图片生成相同哈希
async function getNormalizedBuffer(filePath) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const buffer = fs.readFileSync(filePath);
      if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
        // 归一化重编码（格式保持不变）
        return await sharp(buffer).toBuffer();
      }
      return buffer;
    } catch (error) {
      return fs.readFileSync(filePath);
    }
  }
  
  // 将 generateFileName 改为异步函数，使用归一化后的 buffer 计算 MD5 哈希
  async function generateFileName(originalPath) {
    const year = new Date().getFullYear();
    const month = (new Date().getMonth() + 1).toString().padStart(2, '0');
  
    const normalizedBuffer = await getNormalizedBuffer(originalPath);
    const hash = crypto
      .createHash('md5')
      .update(normalizedBuffer)
      .digest('hex')
      .substring(0, 8);
  
    const ext = path.extname(originalPath);
    return `${year}-${month}-${hash}${ext}`;
  }

async function uploadFile(filePath) {
    try {
        const fileStream = fs.createReadStream(filePath);
        const fileName = await generateFileName(filePath);
        
        const formData = new FormData();
        formData.append('file', fileStream, fileName);

        const response = await axios.post(POST_URL, formData, {
            headers: formData.getHeaders()
        });

        if (response.status !== 200) {
            throw new Error(`上传失败: ${response.data.details || '未知错误'}`);
        }

        const result = response.data;
        if (!result.imageUrl) {
            throw new Error('上传成功但未返回文件 URL');
        }

        return `${GET_URL}${result.imageUrl}`;
    } catch (error) {
        console.error('上传文件出错:', error.response ? error.response.data : error.message);
        throw error;
    }
}

async function handlePastedImage(editor) {
    try {
        const tempDir = path.join(__dirname, 'temp');
        try {
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
                console.log(`临时目录创建成功: ${tempDir}`);
            }
            // 测试写入权限
            fs.writeFileSync(path.join(tempDir, 'test.txt'), 'test');
        } catch (e) {
            vscode.window.showErrorMessage(`临时目录不可写: ${e.message}`);
            throw e;
        }
        const imageName = `image-${Date.now()}.png`;
        const imagePath = path.join(tempDir, imageName);
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const platform = process.platform;
        await new Promise((resolve, reject) => {
            if (platform === 'win32') {
                const scriptPath = path.join(__dirname, 'asserts', 'pc.ps1');
                if (!fs.existsSync(scriptPath)) {
                    throw new Error(`PowerShell 脚本不存在: ${scriptPath}`);
                }
                const command = fs.existsSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') 
                    ? 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe' 
                    : 'powershell';

                // 修改后的调用方式
                const powershell = spawn(command, [
                    '-noprofile',
                    '-noninteractive',
                    '-nologo',
                    '-sta',
                    '-executionpolicy', 'Bypass',
                    '-windowstyle', 'hidden',
                    '-Command',
                    `& "${scriptPath}" -imagePath "${imagePath}"`
                ]);

                const timer = setTimeout(() => powershell.kill(), 15000);
                let output = '';

                powershell.on('error', (e) => {
                    clearTimeout(timer);
                    if (e.code === 'ENOENT') {
                        vscode.window.showErrorMessage('未找到 PowerShell');
                    }
                    reject(e);
                });

                let errorOutput = '';
                powershell.stderr.on('data', (data) => {
                    errorOutput += data.toString();
                });
                
                powershell.on('close', (code) => {
                    if (code !== 0) {
                        console.error(`PowerShell 错误输出: ${errorOutput}`);
                        reject(new Error(`脚本执行失败 (${code}): ${errorOutput}`));
                    } else {
                        resolve(output);
                    }
                });

                powershell.stdout.on('data', (data) => {
                    output += data.toString();
                    clearTimeout(timer);
                    timer = setTimeout(() => powershell.kill(), 2000);
                });

            } else if (platform === 'darwin') {
                const scriptPath = path.join(__dirname, 'assets/mac.applescript');
                const ascript = spawn('osascript', [scriptPath, imagePath]);

                ascript.on('error', (e) => reject(e));
                ascript.on('close', (code) => {
                    code === 0 ? resolve() : reject(new Error(`AppleScript 退出码 ${code}`));
                });

            } else {
                const scriptPath = path.join(__dirname, 'assets/linux.sh');
                const ascript = spawn('sh', [scriptPath, imagePath]);

                ascript.on('error', (e) => reject(e));
                ascript.stdout.on('data', (data) => {
                    const result = data.toString().trim();
                    if (result === "no xclip") {
                        reject(new Error('请先安装 xclip'));
                    } else {
                        resolve();
                    }
                });
            }
        });

        if (!fs.existsSync(imagePath)) {
            throw new Error('无法从剪贴板获取图片');
        }

        const imageUrl = await uploadFile(imagePath);
        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, `![${imageName}](${imageUrl} "${imageName}")`);
        });

        fs.unlinkSync(imagePath);
        vscode.window.showInformationMessage('图片上传成功！');
    } catch (error) {
        vscode.window.showErrorMessage(`图片上传失败: ${error.message}\n${error.stack || ''}`);
    }
}

async function handleSelectedImage() {
    try {
        const result = await vscode.window.showOpenDialog({
            filters: { 'Images': ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
            canSelectMany: false
        });

        if (!result?.[0]?.fsPath) return;

        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        
        const imageUrl = await uploadFile(result[0].fsPath);
        const imageName = path.basename(result[0].fsPath);

        await editor.edit(editBuilder => {
            editBuilder.insert(editor.selection.active, `![${imageName}](${imageUrl} "${imageName}")`);
        });

        vscode.window.showInformationMessage('图片上传成功！');
    } catch (error) {
        vscode.window.showErrorMessage(`图片上传失败: ${error.message}\n${error.stack || ''}`);
    }
}

function activate(context) {
    const pasteCmd = vscode.commands.registerCommand('okyimages.pasteImage', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'markdown') {
            handlePastedImage(editor);
        }
    });

    const selectCmd = vscode.commands.registerCommand('okyimages.selectImage', () => {
        if (vscode.window.activeTextEditor?.document.languageId === 'markdown') {
            handleSelectedImage();
        }
    });

    context.subscriptions.push(pasteCmd, selectCmd);
}

function deactivate() {}

module.exports = { activate, deactivate };