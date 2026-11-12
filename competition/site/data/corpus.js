/* 由 workbuddy/demo/corpus.json 原样生成，勿手改；构建命令见 README.md。
 * 用 script 标签加载，避免 file:// 与跨域 fetch 限制。 */
(function (root, factory) {
  var data = factory();
  root.BUXUE_CORPUS = data;
  if (typeof module !== "undefined" && module.exports) module.exports = data;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  return {
  "courses": {
    "os": "演示课·并发控制",
    "dsd": "演示课·数字电路",
    "other": "演示课·会议管理"
  },
  "sources": [
    {
      "key": "cv",
      "course": "os",
      "title": "并发控制演示讲义",
      "kind": "material",
      "chunks": [
        {
          "page": 3,
          "text": "条件变量（condition variable，CV）的唤醒只意味着线程可以再检查谓词。线程要在持有互斥锁的情况下检查共享队列是否为空。消费者甲从等待返回之前，消费者乙可能已经取走了最后一个元素。虚假唤醒也可能使等待提前返回。"
        },
        {
          "page": 4,
          "text": "用 while 循环在唤醒后重新检查谓词。只用 if 检查一次时，消费者可能从空队列取元素。循环检查和互斥锁共同保护队列操作。"
        },
        {
          "page": 4,
          "text": "信号量（semaphore）则维护许可数，释放操作可以留下供后来线程使用的许可。"
        }
      ]
    },
    {
      "key": "sync_video",
      "course": "os",
      "title": "演示课时一 · 回放字幕",
      "kind": "school_subtitle",
      "meta": {
        "course_id": 9900991,
        "sub_id": 9900992,
        "page_url": "https://video.jw.scut.edu.cn/livingroom?course_id=9900991&sub_id=9900992"
      },
      "chunks": [
        {
          "basis": "video",
          "start": 92,
          "end": 99,
          "text": "回到条件变量。线程收到唤醒后，必须重新检查共享队列的谓词。"
        },
        {
          "basis": "video",
          "start": 104,
          "end": 110,
          "text": "另一消费者可能先获得锁。不能因为通知到了就认为队列一定有元素。"
        }
      ]
    },
    {
      "key": "sync_asr",
      "course": "os",
      "title": "演示课时一 · 含误识别的转写",
      "kind": "asr",
      "meta": {
        "course_id": 9900991,
        "sub_id": 9900992,
        "page_url": "https://video.jw.scut.edu.cn/livingroom?course_id=9900991&sub_id=9900992"
      },
      "chunks": [
        {
          "basis": "video",
          "start": 92,
          "end": 99,
          "text": "回到条件变量。线程收到唤醒后，不用重新检查共享队列的谓词。"
        }
      ]
    },
    {
      "key": "sync_capture",
      "course": "os",
      "title": "演示课时二 · 现场录音",
      "kind": "asr",
      "meta": {
        "page_url": "https://video.jw.scut.edu.cn/livingroom?course_id=9900991&sub_id=9900993"
      },
      "chunks": [
        {
          "basis": "capture",
          "start": 17,
          "end": 24,
          "text": "虚假唤醒发生时，条件变量可能在没有通知的情况下返回。"
        }
      ]
    },
    {
      "key": "timing_old",
      "origin": "timing",
      "course": "dsd",
      "title": "数字电路演示讲义旧版",
      "kind": "material",
      "chunks": [
        {
          "page": 2,
          "text": "旧稿把建立时间写成时钟沿后，供失效版本检查。"
        }
      ]
    },
    {
      "key": "timing",
      "course": "dsd",
      "title": "数字电路演示讲义",
      "kind": "material",
      "chunks": [
        {
          "page": 7,
          "text": "建立时间（setup time）要求数据在有效时钟沿之前稳定。保持时间（hold time）要求数据在该时钟沿之后继续稳定。例题使用实验标签松针-27。若上升沿在 8 ns，建立时间为 2 ns，数据在 7 ns 才变为稳定，那么沿前仅稳定了 1 ns，建立时间少了 1 ns。"
        },
        {
          "page": 8,
          "text": "同步复位（synchronous reset）在有效时钟沿采样。若复位在两个有效沿之间变化，寄存器在下一个有效沿才根据当时的复位值更新。异步复位的行为取决于元件对异步控制端的定义。"
        }
      ]
    },
    {
      "key": "timing_index",
      "course": "other",
      "title": "synchronous reset",
      "kind": "material",
      "chunks": [
        {
          "page": 1,
          "text": "这个标题用于测试正文优先。内容介绍会议预约。"
        }
      ]
    },
    {
      "key": "wrong_course",
      "course": "other",
      "title": "会议预约讲义",
      "kind": "material",
      "chunks": [
        {
          "page": 1,
          "text": "这里把条件变量（condition variable）作为会务表格字段名。它记录场地可用性。"
        }
      ]
    },
    {
      "key": "excluded",
      "course": "os",
      "title": "已停用的并发笔记",
      "kind": "material",
      "excluded": true,
      "chunks": [
        {
          "page": 1,
          "text": "condition variable 每次唤醒都保证条件成立。"
        }
      ]
    },
    {
      "key": "wait_lab",
      "course": "os",
      "title": "并发控制演示讲义 · 等待与唤醒",
      "kind": "material",
      "chunks": [
        {
          "page": 5,
          "text": "队列非空是消费者要检查的谓词（predicate）。消费者持有互斥锁检查队列；如果队列为空，调用 pthread_cond_wait 时释放锁并进入等待，返回前重新取得同一把锁。锁让检查和取元素都能在受保护的区域内进行。\n"
        },
        {
          "page": 6,
          "text": "甲和乙都在等待。生产者在锁内加入一个元素，并唤醒等待者。乙先拿到锁并取走唯一元素。甲随后拿到锁，此时队列已空。甲重新检查队列后应继续等待。\n"
        },
        {
          "page": 7,
          "text": "把 while 改成 if 后，从等待返回的线程会跳过第二次队列检查。在第 6 页的轨迹中，甲接着取元素时队列已空。用 while 时，每次从等待返回都先检查队列。"
        },
        {
          "page": 8,
          "text": "如果生产者加入两个元素，乙先拿锁并只取一个，甲拿到锁时看到的队列是什么状态？在其间没有其他线程修改队列的条件下，甲会看到队列仍有一个元素，循环检查通过后可以取走它。"
        }
      ]
    },
    {
      "key": "timing_lab",
      "course": "dsd",
      "title": "松针-27 时序补学讲义",
      "kind": "material",
      "chunks": [
        {
          "page": 9,
          "text": "松针-27 原例的采样沿在 8 ns，D 在 7 ns 变为稳定，在 9.5 ns 再次变化。建立时间（setup time）要求沿前稳定 2 ns，保持时间（hold time）要求沿后稳定 1 ns。先在时钟上标出 8 ns，再在数据线上找到采样沿左右最近的两次变化。",
          "illustration": "songzhen27-waveform.png",
          "illustration_alt": "松针-27：D 在 7 ns 上升，时钟在 8 ns 采样，D 在 9.5 ns 下降。"
        },
        {
          "page": 10,
          "text": "沿前实际稳定 8 − 7 = 1 ns，比建立时间要求少 2 − 1 = 1 ns。沿后实际稳定 9.5 − 8 = 1.5 ns，满足 1 ns 的保持时间要求。两项要分别检查。\n"
        },
        {
          "page": 11,
          "text": "把 D 变为稳定的时刻从 7 ns 改为 6 ns，采样沿仍在 8 ns，D 下次变化仍在 9.5 ns。沿前稳定 8 − 6 = 2 ns，恰好满足建立时间要求；沿后稳定 1.5 ns，仍满足保持时间要求。\n"
        },
        {
          "page": 12,
          "text": "若 D 在 5.5 ns 稳定，在 8.5 ns 再次变化，采样沿仍在 8 ns。沿前稳定 2.5 ns，满足 2 ns 的建立时间要求；沿后只稳定 0.5 ns，比 1 ns 的保持时间要求少 0.5 ns。"
        }
      ]
    },
    {
      "key": "os_course_notice",
      "course": "os",
      "title": "并发控制模拟教师通知",
      "kind": "course_notice",
      "meta": {
        "publisher": "teacher",
        "simulated": true
      },
      "chunks": [
        {
          "page": 1,
          "section": "考试时间",
          "notice": "exam_time",
          "text": "并发控制演示课的期末考试安排在 2026 年 11 月 24 日 19:00–20:30（北京时间）。考场待后续通知。\n"
        },
        {
          "page": 1,
          "section": "考试范围",
          "notice": "exam_scope",
          "text": "并发控制演示课的期末考试覆盖互斥锁（mutex）、条件变量（condition variable）、队列谓词与 while 重检，以及条件变量与信号量（semaphore）的比较。需要能判断两个消费者先后取锁时的执行顺序。\n"
        },
        {
          "page": 1,
          "section": "作业截止",
          "notice": "assignment_due",
          "text": "并发控制演示课的「消费者等待与唤醒」作业须于 2026 年 11 月 18 日 22:00（北京时间）前提交。\n"
        },
        {
          "page": 1,
          "section": "作业要求",
          "notice": "assignment_requirements",
          "text": "作业提交一张两个消费者的执行时间线和一段等待循环。说明后拿到锁的消费者为什么要重检队列，并指出把 while 改成 if 后哪一步会出问题。"
        }
      ]
    },
    {
      "key": "dsd_course_notice",
      "course": "dsd",
      "title": "数字电路模拟教师通知",
      "kind": "course_notice",
      "meta": {
        "publisher": "teacher",
        "simulated": true
      },
      "chunks": [
        {
          "page": 1,
          "section": "考试时间",
          "notice": "exam_time",
          "text": "数字电路演示课的期末考试安排在 2026 年 11 月 26 日 14:30–16:00（北京时间）。考场待后续通知。\n"
        },
        {
          "page": 1,
          "section": "考试范围",
          "notice": "exam_scope",
          "text": "数字电路演示课的期末考试覆盖建立时间（setup time）、保持时间（hold time）和同步复位（synchronous reset）。题目要求从给定波形读取采样沿和数据变化时刻，分别判断沿前与沿后时序是否满足要求。"
        }
      ]
    },
    {
      "key": "timing_due_original",
      "origin": "songzhen27_due",
      "course": "dsd",
      "title": "松针-27 原始实验通知",
      "kind": "course_notice",
      "meta": {
        "publisher": "teacher",
        "simulated": true,
        "assignment": "松针-27"
      },
      "chunks": [
        {
          "page": 1,
          "section": "实验安排",
          "notice": "assignment_due",
          "text": "松针-27 实验报告的提交截止时间为 2026 年 11 月 16 日 22:00（北京时间）。"
        }
      ]
    },
    {
      "key": "timing_due_current",
      "origin": "songzhen27_due",
      "course": "dsd",
      "title": "松针-27 教师改期通知",
      "kind": "course_notice",
      "meta": {
        "publisher": "teacher",
        "simulated": true,
        "assignment": "松针-27"
      },
      "chunks": [
        {
          "page": 1,
          "section": "提交期限更新",
          "notice": "assignment_due",
          "text": "松针-27 实验报告的提交截止时间提前到 2026 年 11 月 15 日 20:00（北京时间）。"
        }
      ]
    },
    {
      "key": "timing_due_peer",
      "course": "dsd",
      "title": "松针-27 同学转述",
      "kind": "student_report",
      "meta": {
        "publisher": "student",
        "simulated": true,
        "assignment": "松针-27"
      },
      "chunks": [
        {
          "page": 1,
          "section": "作业截止",
          "notice": "assignment_due",
          "text": "听说松针-27 实验报告的提交截止时间提前到 2026 年 11 月 15 日 20:00（北京时间）。"
        }
      ]
    },
    {
      "key": "timing_lab_requirements",
      "course": "dsd",
      "title": "松针-27 原始实验通知",
      "kind": "course_notice",
      "meta": {
        "publisher": "teacher",
        "simulated": true,
        "assignment": "松针-27"
      },
      "chunks": [
        {
          "page": 1,
          "section": "实验安排",
          "notice": "assignment_requirements",
          "text": "报告需给出上升沿、数据稳定时刻和建立时间（setup time），再根据这三个量判断是否满足建立时间要求。"
        }
      ]
    }
  ],
  "aliases": [
    {
      "course": "os",
      "canonical": "condition variable",
      "zh": "条件变量",
      "aliases": [
        "CV"
      ],
      "refs": [
        "cv:0"
      ]
    },
    {
      "course": "dsd",
      "canonical": "setup time",
      "zh": "建立时间",
      "aliases": [],
      "refs": [
        "timing:0"
      ]
    },
    {
      "course": "dsd",
      "canonical": "hold time",
      "zh": "保持时间",
      "aliases": [],
      "refs": [
        "timing:0"
      ]
    },
    {
      "course": "dsd",
      "canonical": "synchronous reset",
      "zh": "同步复位",
      "aliases": [],
      "refs": [
        "timing:1"
      ]
    }
  ],
  "queries": [
    {
      "id": "cv_zh",
      "course": "os",
      "query": "条件变量",
      "expected": [
        "cv:0",
        "sync_video:0"
      ]
    },
    {
      "id": "cv_en",
      "course": "os",
      "query": "condition variable",
      "expected": [
        "cv:0"
      ]
    },
    {
      "id": "cv_alias",
      "course": "os",
      "query": "CV",
      "expected": [
        "cv:0",
        "sync_video:0"
      ]
    },
    {
      "id": "loop_condition",
      "course": "os",
      "query": "while 循环",
      "expected": [
        "cv:1"
      ]
    },
    {
      "id": "semaphore_contrast",
      "course": "os",
      "query": "semaphore",
      "expected": [
        "cv:2"
      ]
    },
    {
      "id": "setup_zh",
      "course": "dsd",
      "query": "建立时间",
      "expected": [
        "timing:0"
      ]
    },
    {
      "id": "hold_en",
      "course": "dsd",
      "query": "hold time",
      "expected": [
        "timing:0"
      ]
    },
    {
      "id": "cross_course_title",
      "course": "",
      "query": "synchronous reset",
      "expected": [
        "timing:1"
      ],
      "first": "timing:1"
    },
    {
      "id": "active_revision",
      "course": "dsd",
      "query": "时钟沿 建立时间",
      "expected": [
        "timing:0"
      ]
    },
    {
      "id": "capture_location",
      "course": "os",
      "query": "虚假唤醒",
      "expected": [
        "sync_capture:0",
        "cv:0"
      ]
    },
    {
      "id": "unknown_term",
      "course": "os",
      "query": "Frobenius eigenvalue",
      "expected": []
    },
    {
      "id": "other_course",
      "course": "dsd",
      "query": "condition variable",
      "expected": []
    }
  ]
};
});
