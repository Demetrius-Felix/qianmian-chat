<template>
  <!-- ============================================================
    页面：自定义角色创建/编辑
    功能：新建角色 · 编辑角色 · 管理已创建角色列表
    数据格式：与标准人设JSON结构完全一致
    ============================================================ -->
  <view class="page">
    <!-- ========== 顶部 Tab 切换 ========== -->
    <view class="tab-bar">
      <view
        class="tab-item"
        :class="{ active: activeTab === 'edit' }"
        @tap="switchTab('edit')"
      >
        <text>✏️ 编辑角色</text>
      </view>
      <view
        class="tab-item"
        :class="{ active: activeTab === 'manage' }"
        @tap="switchTab('manage')"
      >
        <text>📋 角色管理</text>
      </view>
    </view>

    <!-- ============================================================
      选项卡1：编辑角色
      ============================================================ -->
    <view v-show="activeTab === 'edit'" class="edit-container">
      <scroll-view scroll-y class="form-scroll">
        <!-- ---------- 1. 基本信息 ---------- -->
        <view class="section">
          <view class="section-title">📋 基本信息</view>

          <!-- 角色ID -->
          <view class="field">
            <text class="label">
              角色ID <text class="required">*</text>
              <text class="tip">（英文+下划线，唯一标识）</text>
            </text>
            <input
              class="input"
              v-model="form.id"
              placeholder="例: assistant_teacher"
              :disabled="isEditing"
              :class="{ disabled: isEditing }"
            />
            <text class="field-desc" v-if="isEditing">编辑模式下不可修改ID，如需更改请新建角色</text>
            <text class="error" v-if="errors.id">{{ errors.id }}</text>
          </view>

          <!-- templateId -->
          <view class="field">
            <text class="label">templateId <text class="tip">（模板标识）</text></text>
            <input
              class="input"
              v-model="form.templateId"
              placeholder="默认 casual，可自定义"
            />
          </view>

          <!-- 角色名称 -->
          <view class="field">
            <text class="label">角色名称 <text class="required">*</text></text>
            <input
              class="input"
              v-model="form.name"
              placeholder="输入角色名称，如：小爱老师"
            />
            <text class="error" v-if="errors.name">{{ errors.name }}</text>
          </view>

          <!-- 头像：Emoji + 本地图片 -->
          <view class="field">
            <text class="label">头像 <text class="tip">（点击下方 Emoji 选择，或从相册选取图片）</text></text>
            <view class="avatar-row">
              <!-- 当前头像预览 -->
              <view class="avatar-preview">
                <text v-if="isEmoji(form.avatar)" class="avatar-emoji">{{ form.avatar || '😎' }}</text>
                <image v-else :src="form.avatar" class="avatar-image" mode="aspectFill" />
              </view>
              <view class="avatar-btns">
                <button class="btn btn-sm" @tap="showEmojiPicker = !showEmojiPicker">
                  {{ showEmojiPicker ? '收起' : '选Emoji' }}
                </button>
                <button class="btn btn-sm btn-outline" @tap="chooseAvatarImage">选图片</button>
                <button class="btn btn-sm btn-text" @tap="form.avatar = '😎'">重置</button>
              </view>
            </view>
            <!-- Emoji 选择网格 -->
            <view v-if="showEmojiPicker" class="emoji-grid">
              <text
                v-for="(emoji, idx) in emojiList"
                :key="idx"
                class="emoji-item"
                :class="{ active: form.avatar === emoji }"
                @tap="selectEmoji(emoji)"
              >{{ emoji }}</text>
            </view>
          </view>
        </view>

        <!-- ---------- 2. 角色设定 ---------- -->
        <view class="section">
          <view class="section-title">📖 角色设定</view>

          <!-- 身份背景 -->
          <view class="field">
            <text class="label">
              身份背景 / 性格描述 <text class="required">*</text>
              <text class="tip">（核心人设、背景故事、性格特点）</text>
            </text>
            <textarea
              class="textarea"
              v-model="form.identity"
              placeholder="描述角色的核心人设、背景故事和性格特征，越详细角色越立体"
              maxlength="2000"
            />
            <text class="char-count">{{ form.identity.length }}/2000</text>
            <text class="error" v-if="errors.identity">{{ errors.identity }}</text>
          </view>
        </view>

        <!-- ---------- 3. 语音与台词 ---------- -->
        <view class="section">
          <view class="section-title">🎤 语音与台词</view>

          <!-- voice 标签 -->
          <view class="field">
            <text class="label">语音标签 <text class="tip">（角色说话风格标签，可添加多个）</text></text>
            <!-- 已添加的标签 -->
            <view class="tag-list" v-if="form.voice.length > 0">
              <view class="tag" v-for="(item, idx) in form.voice" :key="idx">
                <text class="tag-text">{{ item }}</text>
                <text class="tag-remove" @tap="removeArrayItem('voice', idx)">×</text>
              </view>
            </view>
            <view class="empty-tip" v-else>暂未添加语音标签</view>
            <!-- 新增标签 -->
            <view class="add-row">
              <input
                class="input add-input"
                v-model="tempVoice"
                placeholder="输入语音标签，如：温柔、严肃"
                @confirm="addArrayItem('voice', 'tempVoice')"
              />
              <button class="btn btn-add" @tap="addArrayItem('voice', 'tempVoice')">添加</button>
            </view>
          </view>

          <!-- voice_examples 台词 -->
          <view class="field">
            <text class="label">经典台词 <text class="tip">（角色标志性台词，可添加多条）</text></text>
            <view class="list-items" v-if="form.voice_examples.length > 0">
              <view class="list-item" v-for="(item, idx) in form.voice_examples" :key="idx">
                <text class="list-text">「{{ item }}」</text>
                <text class="list-remove" @tap="removeArrayItem('voice_examples', idx)">删除</text>
              </view>
            </view>
            <view class="empty-tip" v-else>暂未添加台词示例</view>
            <view class="add-row">
              <input
                class="input add-input"
                v-model="tempVoiceExample"
                placeholder="输入角色经典台词"
                @confirm="addArrayItem('voice_examples', 'tempVoiceExample')"
              />
              <button class="btn btn-add" @tap="addArrayItem('voice_examples', 'tempVoiceExample')">添加</button>
            </view>
          </view>
        </view>

        <!-- ---------- 4. 行为规范 ---------- -->
        <view class="section">
          <view class="section-title">📏 行为规范</view>

          <!-- dos -->
          <view class="field">
            <text class="label">行为规范（应做） <text class="tip">（角色应该遵守的行为准则）</text></text>
            <view class="list-items" v-if="form.dos.length > 0">
              <view class="list-item" v-for="(item, idx) in form.dos" :key="idx">
                <text class="list-text dot-green">{{ item }}</text>
                <text class="list-remove" @tap="removeArrayItem('dos', idx)">删除</text>
              </view>
            </view>
            <view class="empty-tip" v-else>暂未添加行为规范</view>
            <view class="add-row">
              <input
                class="input add-input"
                v-model="tempDo"
                placeholder="输入应做的行为，如：耐心解答问题"
                @confirm="addArrayItem('dos', 'tempDo')"
              />
              <button class="btn btn-add" @tap="addArrayItem('dos', 'tempDo')">添加</button>
            </view>
          </view>

          <!-- donts -->
          <view class="field">
            <text class="label">禁忌行为（不应做） <text class="tip">（角色禁止出现的行为）</text></text>
            <view class="list-items" v-if="form.donts.length > 0">
              <view class="list-item" v-for="(item, idx) in form.donts" :key="idx">
                <text class="list-text dot-red">{{ item }}</text>
                <text class="list-remove" @tap="removeArrayItem('donts', idx)">删除</text>
              </view>
            </view>
            <view class="empty-tip" v-else>暂未添加禁忌行为</view>
            <view class="add-row">
              <input
                class="input add-input"
                v-model="tempDont"
                placeholder="输入禁忌行为，如：不允许使用暴力语言"
                @confirm="addArrayItem('donts', 'tempDont')"
              />
              <button class="btn btn-add" @tap="addArrayItem('donts', 'tempDont')">添加</button>
            </view>
          </view>
        </view>

        <!-- ---------- 5. 回复风格 ---------- -->
        <view class="section">
          <view class="section-title">💬 回复风格</view>

          <!-- format -->
          <view class="field">
            <text class="label">回复格式 / 风格描述 <text class="required">*</text></text>
            <textarea
              class="textarea"
              v-model="form.format"
              placeholder="描述回复风格，如：用亲切友好的语气回复，每次回复携带一个有趣的小知识"
              maxlength="500"
            />
            <text class="char-count">{{ form.format.length }}/500</text>
            <text class="error" v-if="errors.format">{{ errors.format }}</text>
          </view>
        </view>

        <!-- ---------- 6. 技能配置 ---------- -->
        <view class="section">
          <view class="section-title">🛠️ 技能配置</view>

          <view class="field">
            <text class="label">角色技能 <text class="tip">（点击预设标签选中 / 取消，也可自定义添加）</text></text>

            <!-- 已选技能 -->
            <view class="tag-list" v-if="form.skills.length > 0">
              <view class="tag tag-skill" v-for="(item, idx) in form.skills" :key="idx">
                <text class="tag-text">{{ item }}</text>
                <text class="tag-remove" @tap="removeArrayItem('skills', idx)">×</text>
              </view>
            </view>

            <!-- 预设技能多选 -->
            <view class="preset-grid">
              <text
                v-for="(skill, idx) in presetSkills"
                :key="idx"
                class="preset-item"
                :class="{ selected: form.skills.includes(skill) }"
                @tap="togglePresetSkill(skill)"
              >{{ skill }}</text>
            </view>

            <!-- 自定义技能输入 -->
            <view class="add-row" style="margin-top: 16rpx;">
              <input
                class="input add-input"
                v-model="tempSkill"
                placeholder="输入自定义技能名称"
                @confirm="addArrayItem('skills', 'tempSkill')"
              />
              <button class="btn btn-add" @tap="addArrayItem('skills', 'tempSkill')">添加</button>
            </view>
          </view>
        </view>

        <!-- ---------- 7. 参数调节 ---------- -->
        <view class="section">
          <view class="section-title">⚙️ 参数调节</view>

          <!-- temperature -->
          <view class="field">
            <text class="label">
              温度 Temperature
              <text class="param-value">{{ form.parameters.temperature.toFixed(2) }}</text>
              <text class="tip">（值越高回复越有创意，越低越严谨）</text>
            </text>
            <view class="slider-row">
              <text class="slider-bound">0</text>
              <slider
                class="slider"
                :value="form.parameters.temperature * 100"
                min="0"
                max="100"
                step="1"
                @change="onTempChange"
                @changing="onTempChanging"
                activeColor="#007AFF"
                backgroundColor="#E5E5EA"
                block-color="#007AFF"
                block-size="20"
              />
              <text class="slider-bound">1</text>
            </view>
            <view class="slider-labels">
              <text>严谨</text>
              <text>创意</text>
            </view>
          </view>

          <!-- max_tokens -->
          <view class="field">
            <text class="label">
              最大 Token 数
              <text class="param-value">{{ form.parameters.max_tokens }}</text>
              <text class="tip">（控制回复长度）</text>
            </text>
            <view class="slider-row">
              <text class="slider-bound">100</text>
              <slider
                class="slider"
                :value="form.parameters.max_tokens"
                min="100"
                max="500"
                step="1"
                @change="onMaxTokensChange"
                @changing="onMaxTokensChanging"
                activeColor="#007AFF"
                backgroundColor="#E5E5EA"
                block-color="#007AFF"
                block-size="20"
              />
              <text class="slider-bound">500</text>
            </view>
          </view>
        </view>

        <!-- ---------- 8. 操作按钮 ---------- -->
        <view class="action-bar">
          <button class="btn btn-primary" @tap="saveRole">💾 保存角色</button>
          <button class="btn btn-secondary" @tap="previewJSON">👁 预览 JSON</button>
          <button class="btn btn-outline" @tap="resetForm">🔄 重置表单</button>
        </view>
      </scroll-view>
    </view>

    <!-- ============================================================
      选项卡2：角色管理
      ============================================================ -->
    <view v-show="activeTab === 'manage'" class="manage-container">
      <!-- 列表头部 -->
      <view class="manage-header">
        <text class="manage-title">已创建角色（{{ roleList.length }}）</text>
        <button class="btn btn-sm btn-primary" @tap="createNewRole">＋ 新建角色</button>
      </view>

      <!-- 空状态 -->
      <view class="empty-state" v-if="roleList.length === 0">
        <text class="empty-icon">📭</text>
        <text class="empty-text">还没有创建任何自定义角色</text>
        <text class="empty-hint">点击上方「新建角色」开始创建</text>
      </view>

      <!-- 角色列表 -->
      <scroll-view scroll-y class="role-list" v-else>
        <view class="role-card" v-for="(role, idx) in roleList" :key="idx">
          <!-- 头像 -->
          <view class="card-avatar">
            <text v-if="isEmoji(role.avatar)" class="card-emoji">{{ role.avatar || '😎' }}</text>
            <image v-else :src="role.avatar" class="card-image" mode="aspectFill" />
          </view>
          <!-- 信息 -->
          <view class="card-info">
            <text class="card-name">{{ role.name || '未命名角色' }}</text>
            <text class="card-id">ID: {{ role.id }}</text>
            <text class="card-skills" v-if="role.skills && role.skills.length > 0">
              技能：{{ role.skills.join('、') }}
            </text>
          </view>
          <!-- 操作 -->
          <view class="card-actions">
            <button class="btn btn-sm btn-outline" @tap="editRole(role.id)">编辑</button>
            <button class="btn btn-sm btn-danger" @tap="deleteRole(role.id)">删除</button>
          </view>
        </view>
      </scroll-view>
    </view>

    <!-- ============================================================
      预览弹窗（展示完整人设 JSON）
      ============================================================ -->
    <view class="modal-overlay" v-if="showPreview" @tap="closePreview">
      <view class="modal-content" @tap.stop>
        <!-- 弹窗标题 -->
        <view class="modal-header">
          <text class="modal-title">📄 人设 JSON 预览</text>
          <text class="modal-close" @tap="closePreview">✕</text>
        </view>
        <!-- JSON 内容展示 -->
        <scroll-view scroll-y class="modal-body">
          <text class="json-text">{{ previewJSON }}</text>
        </scroll-view>
        <!-- 操作按钮 -->
        <view class="modal-actions">
          <button class="btn btn-primary" @tap="copyJSON">📋 复制 JSON</button>
          <button class="btn btn-outline" @tap="closePreview">关闭</button>
        </view>
      </view>
    </view>
	<!-- JSON预览弹窗 -->
	<view v-if="showPreview" class="modal-overlay" @click.self="closePreview">
			<view class="modal-content">
			  <view class="modal-header">
				<text class="modal-title">角色JSON预览</text>
				<button class="modal-close" @tap="closePreview">×</button>
			  </view>
			  <view class="modal-body">
				<scroll-view scroll-y>
				  <text class="json-text">{{ previewJsonStr }}</text>
				</scroll-view>
			  </view>
			  <view class="modal-actions">
				<button class="btn btn-primary" @tap="copyJSON">复制 JSON</button>
				<button class="btn btn-outline" @tap="closePreview">关闭</button>
			  </view>
			</view>
	</view>
  </view>
</template>

<script>
/**
 * ============================================================
 * 自定义角色创建 / 编辑页面
 * ============================================================
 *
 * 【功能说明】
 * 1. 新建自定义角色：填写表单 → 保存到本地存储
 * 2. 编辑已有角色：从管理列表选择 → 加载数据 → 修改 → 保存
 * 3. 角色管理：查看已创建的角色列表，支持编辑和删除
 * 4. JSON预览：一键生成标准格式的人设JSON，支持复制
 *
 * 【数据存储】
 * - 使用 uni.setStorageSync / uni.getStorageSync 操作本地缓存
 * - 存储键名：CUSTOM_ROLES_KEY（'custom_roles'）
 * - 存储结构：角色对象数组
 *
 * 【表单字段对照】
 * 字段名          ←→  人设JSON属性        类型
 * ─────────────────────────────────────────────
 * form.id         ←→  id                  String
 * form.templateId ←→  templateId          String
 * form.name       ←→  name                String
 * form.avatar     ←→  avatar              String
 * form.identity   ←→  identity            String
 * form.voice[]    ←→  voice               Array
 * form.voice_examples[] ←→ voice_examples Array
 * form.dos[]      ←→  dos                 Array
 * form.donts[]    ←→  donts               Array
 * form.format     ←→  format              String
 * form.skills[]   ←→  skills              Array
 * form.parameters ←→  parameters          Object
 *   .temperature  ←→  .temperature        Number (0-1)
 *   .max_tokens   ←→  .max_tokens          Number (100-500)
 * ============================================================
 */

// 本地存储KEY常量
const CUSTOM_ROLES_KEY = 'custom_roles'

export default {
  data() {
    return {
      // ---------- 角色列表（从本地存储加载） ----------
      roleList: [],                // 已创建的角色数组

      // ---------- 当前激活的选项卡 ----------
      activeTab: 'edit',           // 'edit' | 'manage'

      // ---------- 编辑状态 ----------
      isEditing: false,            // true=编辑模式，false=新建模式
      editingId: null,             // 正在编辑的角色ID（null=新建）

      // ---------- 表单数据（与标准人设JSON结构完全对齐） ----------
      form: {
        id: '',                    // 角色唯一标识
        templateId: 'casual',      // 模板ID，默认 casual
        name: '',                  // 角色名称
        avatar: '😎',              // 头像（Emoji字符 或 图片路径）
        identity: '',              // 身份背景/性格描述
        voice: [],                 // 语音风格标签
        voice_examples: [],        // 经典台词
        dos: [],                   // 行为规范（应做）
        donts: [],                 // 禁忌行为（不应做）
        format: '',                // 回复格式描述
        skills: [],                // 技能列表
        parameters: {              // 模型参数
          temperature: 0.7,        // 温度 0-1
          max_tokens: 300          // 最大Token数 100-500
        }
      },

      // ---------- 新增项临时输入 ----------
      tempVoice: '',               // 语音标签输入
      tempVoiceExample: '',        // 台词输入
      tempDo: '',                  // 行为规范输入
      tempDont: '',                // 禁忌行为输入
      tempSkill: '',               // 自定义技能输入

      // ---------- Emoji 选择器 ----------
      showEmojiPicker: false,
      // 预设常用Emoji列表
      emojiList: [
        '😀','😁','😂','🤣','😃','😄','😅','😆',
        '😉','😊','😋','😎','😍','🥰','😘','🤩',
        '🤔','🤗','🤭','😐','😏','😌','😴','🤤',
        '😺','😸','😹','😻','😼','😽','🙀','😿',
        '❤️','🧡','💛','💚','💙','💜','🖤','💖',
        '👍','👎','👌','✌','🤞','🙌','🔥','💡',
        '🌈','⭐','🎯','🎨','🎭','📚','🌸','🌙',
        '🐱','🐶','🐰','🦊','🐻','🐼','🐲','🐸'
      ],

      // ---------- 预设技能选项 ----------
      presetSkills: [
        '角色扮演', '对话生成', '故事创作', '情感分析',
        '知识问答', '编程助手', '翻译润色', '头脑风暴',
        '教学辅导', '心理咨询', '文案写作', '幽默聊天'
      ],

      // ---------- 校验错误信息 ----------
      errors: {},

      // ---------- JSON 预览弹窗 ----------
      showPreview: false,
      previewJsonStr: ''
    }
  },

  /**
   * 页面生命周期：加载
   * 接收 options.id 参数，如果存在则进入编辑模式
   */
  onLoad(options) {
    this.loadRoleList()
    if (options && options.id) {
      this.editRole(options.id)
    }
  },

  methods: {
	copyJSON() {
	  if (!this.previewJsonStr) {
	    uni.showToast({ title: '没有可复制的JSON', icon: 'none' })
	    return
	  }
	
	  // H5端直接用浏览器原生复制，兼容性更好
	  const textArea = document.createElement('textarea')
	  textArea.value = this.previewJsonStr
	  // 把文本框隐藏起来，不影响页面
	  textArea.style.position = 'fixed'
	  textArea.style.opacity = '0'
	  document.body.appendChild(textArea)
	  textArea.select()
	  
	  try {
	    document.execCommand('copy')
	    uni.showToast({ title: '复制成功！', icon: 'success' })
	  } catch (err) {
	    console.error('复制失败：', err)
	    uni.showToast({ title: '复制失败，请手动复制弹窗里的内容', icon: 'none' })
	  } finally {
	    document.body.removeChild(textArea)
	  }
	},
    /* ============================================================
      选项卡切换
      ============================================================ */
    switchTab(tab) {
      this.activeTab = tab
      // 切换到管理标签时刷新列表
      if (tab === 'manage') {
        this.loadRoleList()
      }
    },

    /* ============================================================
      存储：加载 / 保存 / 删除角色
      ============================================================ */

    /**
     * 从本地存储加载角色列表
     */
    loadRoleList() {
      try {
        const data = uni.getStorageSync(CUSTOM_ROLES_KEY)
        this.roleList = data || []
      } catch (e) {
        console.error('读取角色列表失败：', e)
        this.roleList = []
      }
    },

    /**
     * 将角色列表保存到本地存储
     * @param {Array} list - 要保存的角色列表
     */
    saveRoleList(list) {
      try {
        uni.setStorageSync(CUSTOM_ROLES_KEY, list)
        this.roleList = list
      } catch (e) {
        console.error('保存角色列表失败：', e)
        uni.showToast({ title: '保存失败', icon: 'none' })
      }
    },

    /* ============================================================
      数据增删操作
      ============================================================ */

    /**
     * 给指定数组字段添加一项
     * @param {string} field - 字段名，如 'voice', 'dos'
     * @param {string} tempKey - 临时输入框绑定的变量名，如 'tempVoice'
     */
    addArrayItem(field, tempKey) {
      const value = this[tempKey].trim()
      if (!value) {
        uni.showToast({ title: '请输入内容', icon: 'none' })
        return
      }
      this.form[field].push(value)
      this[tempKey] = '' // 清空输入
    },

    /**
     * 从指定数组字段移除一项
     * @param {string} field - 字段名
     * @param {number} index - 要移除的索引
     */
    removeArrayItem(field, index) {
      this.form[field].splice(index, 1)
    },

    /**
     * 点击预设技能切换选中/取消
     * @param {string} skill - 技能名称
     */
    togglePresetSkill(skill) {
      const idx = this.form.skills.indexOf(skill)
      if (idx === -1) {
        this.form.skills.push(skill)
      } else {
        this.form.skills.splice(idx, 1)
      }
    },

    /* ============================================================
      头像操作
      ============================================================ */

    /**
     * 判断字符串是否是 Emoji（用于展示时区分文字和图片）
     * Emoji 字符通常在 Unicode 的特定区间
     */
    isEmoji(str) {
      if (!str) return true
      // 如果以 http 或 / 开头，视为图片路径
      return !(str.startsWith('http') || str.startsWith('/') || str.startsWith('wxfile'))
    },

    /**
     * 从 Emoji 选择器选中一个 Emoji
     */
    selectEmoji(emoji) {
      this.form.avatar = emoji
      this.showEmojiPicker = false
    },

    /**
     * 从相册选择图片作为头像
     */
    chooseAvatarImage() {
      uni.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album'],
        success: (res) => {
          if (res.tempFilePaths && res.tempFilePaths.length > 0) {
            this.form.avatar = res.tempFilePaths[0]
            uni.showToast({ title: '头像已更新', icon: 'success' })
          }
        },
        fail: (err) => {
          // 用户取消选择不提示错误
          if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
            uni.showToast({ title: '选择图片失败', icon: 'none' })
          }
        }
      })
    },

    /* ============================================================
      滑块参数调节
      ============================================================ */

    /**
     * Temperature 滑块值变化（拖动结束）
     * 滑块的 value 范围 0-100，映射到 temperature 范围 0-1
     */
    onTempChange(e) {
      this.form.parameters.temperature = Math.round((e.detail.value / 100) * 100) / 100
    },

    /**
     * Temperature 滑块值变化（拖动中，实时显示）
     */
    onTempChanging(e) {
      this.form.parameters.temperature = Math.round((e.detail.value / 100) * 100) / 100
    },

    /**
     * max_tokens 滑块值变化（拖动结束）
     */
    onMaxTokensChange(e) {
      this.form.parameters.max_tokens = e.detail.value
    },

    /**
     * max_tokens 滑块值变化（拖动中，实时显示）
     */
    onMaxTokensChanging(e) {
      this.form.parameters.max_tokens = e.detail.value
    },

    /* ============================================================
      表单校验
      ============================================================ */

    /**
     * 校验表单关键字段
     * @returns {boolean} 是否通过校验
     */
    validateForm() {
      const errors = {}

      // id：必填，仅允许英文大小写和下划线
      if (!this.form.id.trim()) {
        errors.id = '角色ID不能为空'
      } else if (!/^[a-zA-Z_]+$/.test(this.form.id)) {
        errors.id = '角色ID只能包含英文和下划线'
      } else {
        // 检查ID唯一性（新建时检查是否已存在；编辑时检查是否与其他角色冲突）
        const exists = this.roleList.find(r => r.id === this.form.id)
        if (exists && !this.isEditing) {
          errors.id = '该角色ID已被使用，请更换'
        }
        if (exists && this.isEditing && this.form.id !== this.editingId) {
          errors.id = '该角色ID已被使用，请更换'
        }
      }

      // name：必填
      if (!this.form.name.trim()) {
        errors.name = '角色名称不能为空'
      }

      // identity：必填
      if (!this.form.identity.trim()) {
        errors.identity = '身份背景不能为空'
      }

      // format：必填
      if (!this.form.format.trim()) {
        errors.format = '回复格式描述不能为空'
      }

      this.errors = errors
      return Object.keys(errors).length === 0
    },

    /* ============================================================
      核心操作：保存 / 预览 / 复制 / 重置
      ============================================================ */

    /**
     * 保存角色（新建或更新）
     * 先校验 → 生成JSON → 存入本地存储
     */
    saveRole() {
      // 1. 校验表单
      if (!this.validateForm()) {
        uni.showToast({ title: '请完善表单信息', icon: 'none' })
        return
      }

      // 2. 构建标准JSON结构
      const roleData = this.buildJSON()

      // 3. 获取现有列表并保存
      this.loadRoleList()
      let list = [...this.roleList]

      if (this.isEditing) {
        // 编辑模式：替换原有角色（按 editingId 匹配）
        const idx = list.findIndex(r => r.id === this.editingId)
        if (idx !== -1) {
          list[idx] = roleData
        } else {
          // 如果没找到原记录（异常情况），追加
          list.push(roleData)
        }
        uni.showToast({ title: '角色已更新', icon: 'success' })
      } else {
        // 新建模式：追加到列表
        list.push(roleData)
        uni.showToast({ title: '角色创建成功', icon: 'success' })
      }

      // 4. 保存到本地存储
      this.saveRoleList(list)
    },

    /**
     * 根据表单数据构建标准人设 JSON 对象
     * 返回的结构与用户提供的标准格式完全一致
     * @returns {Object} 标准人设JSON对象
     */
    buildJSON() {
      return {
        id: this.form.id.trim(),
        templateId: this.form.templateId.trim() || 'casual',
        name: this.form.name.trim(),
        avatar: this.form.avatar || '😎',
        identity: this.form.identity.trim(),
        voice: [...this.form.voice],
        voice_examples: [...this.form.voice_examples],
        dos: [...this.form.dos],
        donts: [...this.form.donts],
        format: this.form.format.trim(),
        skills: [...this.form.skills],
        parameters: {
          temperature: this.form.parameters.temperature,
          max_tokens: this.form.parameters.max_tokens
        }
      }
    },

    /**
     * 预览JSON：生成并在弹窗中展示
     */
    previewJSON() {
      // 先尝试校验，但不阻止预览
      if (!this.form.id.trim() || !this.form.name.trim()) {
        uni.showToast({ title: '提示：部分必填项未填写', icon: 'none' })
      }
      const data = this.buildJSON()
      this.previewJsonStr = JSON.stringify(data, null, 2)
      this.showPreview = true
    },

    /**
     * 关闭预览弹窗
     */
    closePreview() {
      this.showPreview = false
      this.previewJsonStr = ''
    },

    /**
     * 复制 JSON 到剪贴板
     */
    copyJSON() {
      uni.setClipboardData({
        data: this.previewJSON,
        success: () => {
          uni.showToast({ title: '已复制到剪贴板', icon: 'success' })
        },
        fail: () => {
          uni.showToast({ title: '复制失败', icon: 'none' })
        }
      })
    },

    /**
     * 重置表单到初始状态（仅新建模式可用）
     */
    resetForm() {
      uni.showModal({
        title: '确认重置',
        content: '将清空所有已填写的内容，确定吗？',
        success: (res) => {
          if (res.confirm) {
            this.clearForm()
            uni.showToast({ title: '已重置', icon: 'success' })
          }
        }
      })
    },

    /**
     * 清空表单数据（回到默认值）
     */
    clearForm() {
      this.form = {
        id: '',
        templateId: 'casual',
        name: '',
        avatar: '😎',
        identity: '',
        voice: [],
        voice_examples: [],
        dos: [],
        donts: [],
        format: '',
        skills: [],
        parameters: {
          temperature: 0.7,
          max_tokens: 300
        }
      }
      this.errors = {}
      this.isEditing = false
      this.editingId = null
    },

    /* ============================================================
      角色管理：编辑 / 删除 / 新建
      ============================================================ */

    /**
     * 加载指定角色到编辑表单
     * @param {string} id - 角色ID
     */
    editRole(id) {
      this.loadRoleList()
      const role = this.roleList.find(r => r.id === id)
      if (!role) {
        uni.showToast({ title: '未找到该角色', icon: 'none' })
        return
      }

      // 深拷贝角色数据到表单
      this.form = JSON.parse(JSON.stringify(role))
      this.isEditing = true
      this.editingId = id
      this.errors = {}

      // 切换到编辑选项卡
      this.activeTab = 'edit'

      uni.pageScrollTo({ scrollTop: 0, duration: 100 })
    },

    /**
     * 删除指定角色（需确认）
     * @param {string} id - 角色ID
     */
    deleteRole(id) {
      const role = this.roleList.find(r => r.id === id)
      const name = role ? role.name : id
      uni.showModal({
        title: '确认删除',
        content: `确定要删除角色「${name}」吗？此操作不可恢复。`,
        success: (res) => {
          if (res.confirm) {
            const list = this.roleList.filter(r => r.id !== id)
            this.saveRoleList(list)
            uni.showToast({ title: '已删除', icon: 'success' })
          }
        }
      })
    },

    /**
     * 创建新角色：清空表单并切换到编辑选项卡
     */
    createNewRole() {
      this.clearForm()
      this.activeTab = 'edit'
    }
  }
}
</script>

<style>
/* ============================================================
  页面全局样式
  使用 rpx 单位适配微信小程序
  ============================================================ */

/* ---------- 页面容器 ---------- */
.page {
  min-height: 100vh;
  background-color: #F5F7FA;
  font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif;
}

/* ---------- Tab 切换栏 ---------- */
.tab-bar {
  display: flex;
  background: #FFFFFF;
  border-bottom: 2rpx solid #E5E5EA;
  position: sticky;
  top: 0;
  z-index: 10;
}

.tab-item {
  flex: 1;
  text-align: center;
  padding: 24rpx 0;
  font-size: 28rpx;
  color: #8E8E93;
  position: relative;
  transition: color 0.2s;
}

.tab-item.active {
  color: #007AFF;
  font-weight: 600;
}

.tab-item.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 20%;
  width: 60%;
  height: 4rpx;
  background: #007AFF;
  border-radius: 2rpx;
}

/* ---------- 编辑区域 ---------- */
.edit-container {
  /* 占满剩余高度 */
}

.form-scroll {
  height: calc(100vh - 100rpx);
  padding: 0 30rpx 120rpx;
}

/* ---------- 分区卡片 ---------- */
.section {
  background: #FFFFFF;
  border-radius: 16rpx;
  padding: 30rpx;
  margin-top: 24rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.section-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #1C1C1E;
  margin-bottom: 28rpx;
  padding-bottom: 16rpx;
  border-bottom: 2rpx solid #F0F0F5;
}

/* ---------- 表单项 ---------- */
.field {
  margin-bottom: 28rpx;
}

.field:last-child {
  margin-bottom: 0;
}

.label {
  display: block;
  font-size: 28rpx;
  color: #3C3C43;
  margin-bottom: 12rpx;
  font-weight: 500;
  line-height: 1.5;
}

.required {
  color: #FF3B30;
  font-weight: 700;
}

.tip {
  font-size: 24rpx;
  color: #8E8E93;
  font-weight: 400;
}

.param-value {
  font-size: 28rpx;
  color: #007AFF;
  font-weight: 700;
  margin: 0 8rpx;
}

.field-desc {
  display: block;
  font-size: 22rpx;
  color: #FF9500;
  margin-top: 6rpx;
}

/* ---------- 输入框 ---------- */
.input {
  width: 100%;
  height: 72rpx;
  background: #F9F9FB;
  border: 2rpx solid #E5E5EA;
  border-radius: 12rpx;
  padding: 0 24rpx;
  font-size: 28rpx;
  color: #1C1C1E;
  box-sizing: border-box;
  transition: border-color 0.2s;
}

.input:focus {
  border-color: #007AFF;
}

.input.disabled {
  background: #F0F0F5;
  color: #8E8E93;
}

/* ---------- 多行文本框 ---------- */
.textarea {
  width: 100%;
  min-height: 180rpx;
  background: #F9F9FB;
  border: 2rpx solid #E5E5EA;
  border-radius: 12rpx;
  padding: 20rpx 24rpx;
  font-size: 28rpx;
  color: #1C1C1E;
  box-sizing: border-box;
  line-height: 1.6;
}

.textarea:focus {
  border-color: #007AFF;
}

.char-count {
  display: block;
  text-align: right;
  font-size: 22rpx;
  color: #C7C7CC;
  margin-top: 8rpx;
}

/* ---------- 错误提示 ---------- */
.error {
  display: block;
  font-size: 24rpx;
  color: #FF3B30;
  margin-top: 8rpx;
}

/* ---------- 头像区域 ---------- */
.avatar-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.avatar-preview {
  width: 100rpx;
  height: 100rpx;
  border-radius: 16rpx;
  background: #F0F0F5;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.avatar-emoji {
  font-size: 60rpx;
  line-height: 1;
}

.avatar-image {
  width: 100rpx;
  height: 100rpx;
}

.avatar-btns {
  display: flex;
  gap: 16rpx;
  flex-wrap: wrap;
}

/* ---------- Emoji 选择网格 ---------- */
.emoji-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;
  margin-top: 16rpx;
  padding: 16rpx;
  background: #F9F9FB;
  border-radius: 12rpx;
}

.emoji-item {
  width: 64rpx;
  height: 64rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40rpx;
  border-radius: 12rpx;
  transition: background 0.15s;
}

.emoji-item:active {
  background: #E5E5EA;
  transform: scale(1.15);
}

.emoji-item.active {
  background: #E5F0FF;
  box-shadow: 0 0 0 2rpx #007AFF;
}

/* ---------- 标签列表 ---------- */
.tag-list {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin-bottom: 12rpx;
}

.tag {
  display: flex;
  align-items: center;
  background: #E5F0FF;
  border-radius: 20rpx;
  padding: 8rpx 16rpx;
  gap: 8rpx;
}

.tag-text {
  font-size: 26rpx;
  color: #007AFF;
}

.tag-remove {
  font-size: 30rpx;
  color: #8E8E93;
  padding: 0 4rpx;
  line-height: 1;
}

.tag-remove:active {
  color: #FF3B30;
}

/* ---------- 列表项（台词/规范） ---------- */
.list-items {
  margin-bottom: 12rpx;
}

.list-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #F9F9FB;
  border-radius: 10rpx;
  padding: 16rpx 20rpx;
  margin-bottom: 8rpx;
}

.list-text {
  font-size: 26rpx;
  color: #1C1C1E;
  flex: 1;
  line-height: 1.5;
}

.dot-green::before {
  content: '✅ ';
}

.dot-red::before {
  content: '❌ ';
}

.list-remove {
  font-size: 24rpx;
  color: #FF3B30;
  padding: 8rpx 12rpx;
  flex-shrink: 0;
}

.list-remove:active {
  opacity: 0.6;
}

/* ---------- 添加行 ---------- */
.add-row {
  display: flex;
  gap: 16rpx;
  align-items: center;
}

.add-input {
  flex: 1;
}

/* ---------- 空提示 ---------- */
.empty-tip {
  font-size: 26rpx;
  color: #C7C7CC;
  padding: 12rpx 0;
  margin-bottom: 8rpx;
}

/* ---------- 预设技能网格 ---------- */
.preset-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 12rpx;
  margin: 12rpx 0;
}

.preset-item {
  padding: 10rpx 24rpx;
  font-size: 26rpx;
  color: #3C3C43;
  background: #F0F0F5;
  border-radius: 24rpx;
  border: 2rpx solid transparent;
  transition: all 0.15s;
}

.preset-item:active {
  transform: scale(0.95);
  opacity: 0.8;
}

.preset-item.selected {
  background: #E5F0FF;
  color: #007AFF;
  border-color: #007AFF;
  font-weight: 500;
}

/* ---------- 滑块 ---------- */
.slider-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
}

.slider {
  flex: 1;
}

.slider-bound {
  font-size: 24rpx;
  color: #8E8E93;
  min-width: 48rpx;
  text-align: center;
}

.slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 22rpx;
  color: #C7C7CC;
  padding: 0 64rpx;
  margin-top: -8rpx;
}

/* ---------- 操作按钮 ---------- */
.action-bar {
  margin: 40rpx 0 60rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}

/* ---------- 通用按钮 ---------- */
.btn {
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 12rpx;
  font-size: 28rpx;
  height: 80rpx;
  padding: 0 24rpx;
  transition: opacity 0.15s;
  line-height: 1;
}

.btn:active {
  opacity: 0.8;
}

.btn-primary {
  background: #007AFF;
  color: #FFFFFF;
  font-weight: 600;
}

.btn-secondary {
  background: #5856D6;
  color: #FFFFFF;
  font-weight: 600;
}

.btn-outline {
  background: #FFFFFF;
  color: #007AFF;
  border: 2rpx solid #007AFF;
}

.btn-danger {
  background: #FFFFFF;
  color: #FF3B30;
  border: 2rpx solid #FF3B30;
}

.btn-text {
  background: transparent;
  color: #8E8E93;
  border: none;
  font-size: 26rpx;
  height: auto;
  padding: 0;
}

.btn-sm {
  height: 56rpx;
  font-size: 24rpx;
  padding: 0 20rpx;
  border-radius: 10rpx;
}

.btn-add {
  height: 72rpx;
  min-width: 120rpx;
  font-size: 26rpx;
  background: #007AFF;
  color: #FFFFFF;
  border-radius: 12rpx;
  flex-shrink: 0;
}

/* ---------- 管理页面 ---------- */
.manage-container {
  padding: 24rpx 30rpx;
  height: calc(100vh - 100rpx);
  display: flex;
  flex-direction: column;
}

.manage-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24rpx;
}

.manage-title {
  font-size: 30rpx;
  font-weight: 600;
  color: #1C1C1E;
}

/* ---------- 空状态 ---------- */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 120rpx 0;
}

.empty-icon {
  font-size: 80rpx;
  margin-bottom: 20rpx;
}

.empty-text {
  font-size: 28rpx;
  color: #8E8E93;
  margin-bottom: 12rpx;
}

.empty-hint {
  font-size: 26rpx;
  color: #C7C7CC;
}

/* ---------- 角色列表 ---------- */
.role-list {
  flex: 1;
}

.role-card {
  display: flex;
  align-items: center;
  background: #FFFFFF;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.04);
}

.card-avatar {
  width: 80rpx;
  height: 80rpx;
  border-radius: 14rpx;
  background: #F0F0F5;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 20rpx;
  flex-shrink: 0;
  overflow: hidden;
}

.card-emoji {
  font-size: 48rpx;
}

.card-image {
  width: 80rpx;
  height: 80rpx;
}

.card-info {
  flex: 1;
  min-width: 0;
}

.card-name {
  display: block;
  font-size: 30rpx;
  font-weight: 600;
  color: #1C1C1E;
  margin-bottom: 4rpx;
}

.card-id {
  display: block;
  font-size: 22rpx;
  color: #8E8E93;
  margin-bottom: 4rpx;
}

.card-skills {
  display: block;
  font-size: 22rpx;
  color: #8E8E93;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-actions {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  margin-left: 16rpx;
  flex-shrink: 0;
}

/* ---------- 弹窗（遮罩） ---------- */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60rpx;
}

.modal-content {
  background: #FFFFFF;
  border-radius: 20rpx;
  width: 100%;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 28rpx 30rpx;
  border-bottom: 2rpx solid #F0F0F5;
}

.modal-title {
  font-size: 32rpx;
  font-weight: 600;
  color: #1C1C1E;
}

.modal-close {
  font-size: 36rpx;
  color: #8E8E93;
  padding: 8rpx;
}

.modal-close:active {
  opacity: 0.6;
}

.modal-body {
  flex: 1;
  padding: 24rpx 30rpx;
  max-height: 60vh;
  overflow-y: auto;
}

.json-text {
  font-family: 'Courier New', monospace;
  font-size: 24rpx;
  color: #3C3C43;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-all;
}

.modal-actions {
  display: flex;
  gap: 20rpx;
  padding: 24rpx 30rpx;
  border-top: 2rpx solid #F0F0F5;
}

.modal-actions .btn {
  flex: 1;
}

/* ---------- uni-app 原生组件覆盖 ---------- */
button::after {
  border: none;
}

/* ---------- 滚动条美化 ---------- */
scroll-view ::-webkit-scrollbar {
  width: 4rpx;
}
</style>
