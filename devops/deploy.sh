#!/bin/bash
# ============================================
#  一键部署脚本 (Mac/Linux)
#  将本地项目文件同步到远程服务器并重启服务
# ============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # 无颜色

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONF_FILE="${SCRIPT_DIR}/deploy.conf"

# ============================================
#  打印带颜色的消息
# ============================================
print_info()    { echo -e "${BLUE}[信息]${NC} $1"; }
print_success() { echo -e "${GREEN}[成功]${NC} $1"; }
print_warn()    { echo -e "${YELLOW}[警告]${NC} $1"; }
print_error()   { echo -e "${RED}[错误]${NC} $1"; }
print_step()    { echo -e "${CYAN}[步骤]${NC} $1"; }

# ============================================
#  打印横幅
# ============================================
print_banner() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════╗"
    echo "║         🤖 WeClaw 部署工具               ║"
    echo "╚══════════════════════════════════════════╝"
    echo -e "${NC}"
}

# ============================================
#  检查配置文件
# ============================================
check_config() {
    if [ ! -f "$CONF_FILE" ]; then
        print_error "未找到配置文件: ${CONF_FILE}"
        print_info "请先复制 deploy.conf.example 为 deploy.conf 并填写配置"
        echo ""
        echo "  cp ${SCRIPT_DIR}/deploy.conf.example ${SCRIPT_DIR}/deploy.conf"
        echo "  然后编辑 deploy.conf 填写你的服务器信息"
        echo ""
        exit 1
    fi
}

# ============================================
#  加载配置
# ============================================
load_config() {
    source "$CONF_FILE"

    # 设置默认本地路径为项目根目录
    if [ -z "$LOCAL_PATH" ]; then
        LOCAL_PATH="$(dirname "$SCRIPT_DIR")"
    fi

    # 验证必要配置
    if [ -z "$SERVER_IP" ] || [ "$SERVER_IP" = "192.168.1.100" ]; then
        print_error "请在 deploy.conf 中配置正确的 SERVER_IP"
        exit 1
    fi
    if [ -z "$SERVER_USER" ]; then
        print_error "请在 deploy.conf 中配置 SERVER_USER"
        exit 1
    fi
    if [ -z "$SERVER_PASSWORD" ] || [ "$SERVER_PASSWORD" = "your_password_here" ]; then
        print_error "请在 deploy.conf 中配置正确的 SERVER_PASSWORD"
        exit 1
    fi
    if [ -z "$REMOTE_PATH" ]; then
        print_error "请在 deploy.conf 中配置 REMOTE_PATH"
        exit 1
    fi
    if [ -z "$SERVER_PORT" ]; then
        SERVER_PORT=22
    fi

    # 服务名（pm2 使用），默认取 REMOTE_PATH 的最后一段
    if [ -z "$SERVICE_NAME" ]; then
        SERVICE_NAME="$(basename "$REMOTE_PATH")"
    fi
}

# ============================================
#  检查依赖工具
# ============================================
check_dependencies() {
    local missing=0

    # 检查 sshpass
    if ! command -v sshpass &> /dev/null; then
        print_warn "未安装 sshpass，尝试自动安装..."
        if command -v brew &> /dev/null; then
            brew install hudochenkov/sshpass/sshpass
        elif command -v apt-get &> /dev/null; then
            sudo apt-get install -y sshpass
        elif command -v yum &> /dev/null; then
            sudo yum install -y sshpass
        else
            print_error "无法自动安装 sshpass，请手动安装"
            print_info "Mac: brew install hudochenkov/sshpass/sshpass"
            print_info "Ubuntu: sudo apt-get install sshpass"
            print_info "CentOS: sudo yum install sshpass"
            missing=1
        fi
    fi

    # 检查 rsync
    if ! command -v rsync &> /dev/null; then
        print_error "未安装 rsync，请先安装"
        missing=1
    fi

    if [ $missing -eq 1 ]; then
        exit 1
    fi
}

# ============================================
#  显示部署信息
# ============================================
show_deploy_info() {
    echo ""
    print_info "部署配置信息:"
    echo "  ├── 本地路径:   ${LOCAL_PATH}"
    echo "  ├── 服务器:     ${SERVER_USER}@${SERVER_IP}:${SERVER_PORT}"
    echo "  ├── 远程路径:   ${REMOTE_PATH}"
    echo "  ├── 服务名称:   ${SERVICE_NAME}"
    echo "  └── 排除列表:   ${EXCLUDE_LIST}"
    echo ""
}

# ============================================
#  确认部署
# ============================================
confirm_deploy() {
    # 如果传入了 -y 参数则跳过确认
    if [ "$1" = "-y" ] || [ "$1" = "--yes" ]; then
        return 0
    fi

    read -p "$(echo -e ${YELLOW}[确认]${NC} 是否开始部署？[y/N]: )" answer
    case $answer in
        [Yy]* ) return 0;;
        * ) print_info "已取消部署"; exit 0;;
    esac
}

# ============================================
#  执行文件同步
# ============================================
do_sync() {
    # 构建排除参数
    local exclude_args=""
    for item in $EXCLUDE_LIST; do
        exclude_args="${exclude_args} --exclude=${item}"
    done

    print_step "正在创建远程目录..."
    sshpass -p "$SERVER_PASSWORD" ssh -o StrictHostKeyChecking=no -p "$SERVER_PORT" \
        "${SERVER_USER}@${SERVER_IP}" "mkdir -p ${REMOTE_PATH}"
    print_success "远程目录已就绪"

    print_step "正在同步文件到服务器..."
    echo ""

    # 使用 rsync 同步文件
    sshpass -p "$SERVER_PASSWORD" rsync -avz --progress --delete \
        -e "ssh -o StrictHostKeyChecking=no -p ${SERVER_PORT}" \
        ${exclude_args} \
        "${LOCAL_PATH}/" "${SERVER_USER}@${SERVER_IP}:${REMOTE_PATH}/"

    echo ""
    print_success "文件同步完成！"
}

# ============================================
#  远程执行：安装依赖 & 构建 & 重启服务
# ============================================
do_remote_setup() {
    print_step "正在远程安装依赖并构建项目..."

    # 注意：使用 bash -l 以登录 shell 执行，确保加载 nvm / PATH 等环境变量
    sshpass -p "$SERVER_PASSWORD" ssh -o StrictHostKeyChecking=no -p "$SERVER_PORT" \
        "${SERVER_USER}@${SERVER_IP}" bash -l <<EOF
set -e

# 尝试加载常见的 Node 环境（nvm / fnm / 系统安装）
for profile in /etc/profile ~/.bash_profile ~/.bashrc ~/.profile; do
    [ -f "\$profile" ] && source "\$profile" 2>/dev/null || true
done

# 若 node 依然找不到，尝试常见安装路径
if ! command -v node &>/dev/null; then
    for p in /usr/local/bin /usr/bin ~/.nvm/versions/node/*/bin; do
        [ -x "\$p/node" ] && export PATH="\$p:\$PATH" && break
    done
fi

echo ">>> 环境检查..."
echo "    node: \$(node -v 2>/dev/null || echo '未找到')"
echo "    npm:  \$(npm -v 2>/dev/null || echo '未找到')"
echo "    PATH: \$PATH"

if ! command -v npm &>/dev/null; then
    echo "[错误] 仍然找不到 npm，请先在服务器安装 Node.js："
    echo "       curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -"
    echo "       yum install -y nodejs"
    exit 1
fi

cd "${REMOTE_PATH}"

echo ">>> 清理 Python 字节码缓存..."
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -name "*.pyc" -delete 2>/dev/null || true

echo ">>> 安装 npm 依赖（含 devDependencies，用于构建）..."
npm install

echo ">>> 构建 TypeScript..."
npm run build

echo ">>> 清理 devDependencies..."
npm prune --omit=dev

echo ">>> 解压并配置技能目录中的 CLI 包..."
for archive in config/skills/*/linux-x64/*.tar.gz; do
    if [ -f "\$archive" ]; then
        dir="\$(dirname "\$archive")"
        echo "    解压: \$archive -> \$dir/"

        # 保留已有的 .env（可能有用户手动配置的 API Key）
        env_backup=""
        cli_dir="\$dir/vidnote-cli"
        if [ -f "\$cli_dir/.env" ]; then
            env_backup="\$(cat "\$cli_dir/.env")"
        fi

        tar -xzf "\$archive" -C "\$dir/"

        # 恢复 .env
        if [ -n "\$env_backup" ]; then
            echo "\$env_backup" > "\$cli_dir/.env"
            echo "    已恢复 .env 配置"
        fi

        # 创建 .so 版本号 symlink（whisper.cpp 编译产物需要）
        if [ -d "\$cli_dir" ]; then
            cd "\$cli_dir"
            for so in *.so; do
                [ -f "\$so" ] || continue
                base="\${so%.so}"
                # libwhisper.so -> libwhisper.so.1
                if [ "\$base" = "libwhisper" ]; then
                    ln -sf "\$so" "\${so}.1" 2>/dev/null
                else
                    ln -sf "\$so" "\${so}.0" 2>/dev/null
                fi
            done
            echo "    已创建 .so symlinks"

            # 生成启动脚本（ffmpeg 自动检测 + LD_LIBRARY_PATH）
            cat > vidnote << 'VIDNOTE_SCRIPT'
#!/bin/bash
SCRIPT_DIR="\$(cd "\$(dirname "\$0")" && pwd)"
export LD_LIBRARY_PATH="\$SCRIPT_DIR:\$LD_LIBRARY_PATH"
if "\$SCRIPT_DIR/ffmpeg" -version >/dev/null 2>&1; then
    export FFMPEG_PATH="\$SCRIPT_DIR/ffmpeg"
elif command -v ffmpeg >/dev/null 2>&1; then
    export FFMPEG_PATH="\$(command -v ffmpeg)"
fi
export WHISPER_CPP_PATH="\$SCRIPT_DIR/whisper-cli"
export WHISPER_MODEL_PATH="\$SCRIPT_DIR/ggml-base.bin"
exec "\$SCRIPT_DIR/api_backend" "\$@"
VIDNOTE_SCRIPT
            chmod +x vidnote api_backend whisper-cli 2>/dev/null
            echo "    已生成启动脚本"
            cd "${REMOTE_PATH}"
        fi
    fi
done

echo ">>> 重启服务 (pm2)..."
if command -v pm2 &>/dev/null; then
    if pm2 list | grep -q "${SERVICE_NAME}"; then
        pm2 restart "${SERVICE_NAME}"
        echo ">>> pm2 服务 '${SERVICE_NAME}' 重启成功"
    else
        pm2 start dist/server.js --name "${SERVICE_NAME}"
        pm2 save
        echo ">>> pm2 服务 '${SERVICE_NAME}' 已启动并保存"
    fi
else
    echo ">>> [警告] 未检测到 pm2，跳过服务重启"
    echo ">>> 安装 pm2: npm install -g pm2"
    echo ">>> 手动启动: node dist/server.js"
fi
EOF

    print_success "远程构建与重启完成！"
}


# ============================================
#  主流程
# ============================================
main() {
    print_banner
    check_config
    load_config
    check_dependencies
    show_deploy_info
    confirm_deploy "$1"

    local start_time=$(date +%s)

    do_sync
    do_remote_setup

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║         ✅ 部署成功完成！                ║${NC}"
    printf "${GREEN}║         耗时: %-27s║${NC}\n" "${duration} 秒"
    echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
    echo ""
}

main "$@"
